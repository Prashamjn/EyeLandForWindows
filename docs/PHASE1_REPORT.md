# Liquid Island: Phase 1 completion report

Branch `feature/phase-1-liquid-island-foundation`, based on `main` @ `61ae35c` ("First Commit"). Scope: visual
transformation and new UI foundation only. Phases 2 to 5 are **not** started.

## 1. Summary

The island is redesigned as an original, Dynamic Island-inspired Windows app. All eye identity is gone (blinking,
cursor-tracking pupils, eye colour setting, eye icons, mascot-style visuals, app and tray icons, brand strings).
The Electron architecture, IPC channels, plugin back ends and native helpers are unchanged. No framework was added and no
dependency was added.

Three states, driven by `data-state` on `#island` and animated with CSS only:

| State | Size | Purpose |
|---|---|---|
| Compact | 124x30 (176 wide while the timer/Coffee mode runs) | Plain black capsule, no controls |
| Mini | 320x46 (bar / notice) or 372x66 (media) | Volume, brightness, charging, plugin results, new track |
| Full | 620x388 | Activity area on top, dashboard underneath |

The activity area is one reusable component fed by plain objects (`{icon, title, sub, progress, value, controls}`).
The mini state renders the same objects. New activity types (later phases) only need to call
`LI.activity.show()` or `LI.activity.setBase()`.

Dashboard: clock and date, weather, quick actions, volume/brightness, and plugin navigation by category (with each
plugin's shortcut), plus Timer, Clipboard, Tasks and Settings views.

## 2. Files modified (21)
`README.md`, `assets/icon.ico`, `assets/icon.png`, `assets/tray.png`, `hub/boot.js`, `hub/hub.css`, `hub/index.html`,
`hub/plugins/cleaner.js`, `hub/plugins/qr.js`, `hub/plugins/screen.js`, `hub/plugins/share.js`, `main.js`,
`package.json`, `renderer/index.html` (rewritten), `shared/icons.js` (icons added), `src/capture.js`, `src/net.js`,
`src/pdf.js`, `src/share.js`, and the two deletions below.

## 3. Files added / removed
Added: `renderer/{tokens.css, island.css, dashboard.css, core.js, activity.js, island.js, dashboard.js, panels.js, app.js}`,
`shared/weather.js`, `docs/PHASE1_REPORT.md`, `tools/ui-harness/**`.
Removed: `renderer/style.css`, `renderer/renderer.js` (replaced by the files above; their working logic for overlay,
media, timer, clipboard, tasks and settings was ported, not discarded).

`main.js` changes (targeted, 15 lines): window canvas 560x300 -> 700x460; `eyeColor` default replaced by `accent`; default
edge gap 6 for new installs only; cursor poll 16 -> 33 ms (still used for hover, no longer for eyes); `userData` pinned
to the existing folder; user-visible names.

## 4. Components redesigned
Compact island, mini island, expanded island, activity area, dashboard, clock, weather card, quick actions, volume and
brightness controls, plugin navigation and cards, focus timer, clipboard, tasks, settings, empty states, loading and error
states, notification presentation, plugin hub chrome (brand mark, palette, accent), app icon, tray icon.

## 5. Functionality preserved
Plugin execution path (`api.run` -> `ey:run` -> `runPlugin`) and all 20 plugin back ends; keyboard shortcuts; settings
file and all existing keys; tasks; clipboard history; focus timer logic; volume/brightness control and watchers;
media controls; Coffee mode; fullscreen auto-hide; autostart; window positioning and always-on-top; position top/bottom
and edge gap; themes (`black`, `graphite`, `midnight`, `light` keep their stored values).

## 6. Not implemented (by design, later phases)
Embedded plugin environment, lyrics, waveform, charging sounds/animations, multi-activity prioritisation (Phase 1 uses
a fixed rule: latest transient, else media, else timer, else empty), full Liquid Glass, customisation studio, new
plugin back ends.

## 7. Tests performed and results
Environment: Electron 33.4.11 on **Linux under Xvfb with software rendering**. The real `main.js` was booted with an
isolated settings folder. Harness: `tools/ui-harness` (reproducible).

| Check | Result |
|---|---|
| `node --check` on all JS I touched or added | pass |
| Static: every element id, script, CSS file and icon id referenced by the renderer exists | pass (29 icon ids) |
| `shared/weather.js` unit tests (parse, rounding, night glyphs, missing high/low -> null, throws on 6 kinds of bad data, URL, all WMO codes) | 11/11 |
| 03 behaviour: window geometry/top-centre/always-on-top; userData pin; hover open/close through real `cursor` IPC; expand/collapse sampled every frame (monotonic, no overshoot, 25 in-between frames); one event -> one activity (no duplicate listeners); unsupported brightness hides slider; reduced-motion emulation disables transitions; Coffee and timer compact indicators; timer completion; settings and tasks persisted to disk; no DOM growth over 60 open/close cycles; idle CPU | 21/21 |
| 04 plugins: 21-entry catalog; all 20 plugins reachable in the island by category; each of 15 hub plugins opened from its island card mounts the correct page with no load error; Coffee on/off round trip through main | 6/6 |
| 05 upgrade: legacy `settings.json` (theme, tasks, bottom position, `eyeColor`) keeps theme and tasks, defaults accent to blue, flush bottom edge, island grows upward | 5/5 |
| 06 weather states: network error, malformed payload (no invented data), retry recovery, unit change refetches with the Fahrenheit parameter | 5/5 |
| Screenshots reviewed by eye: compact, 3 mini kinds, full home, every dashboard view, light + green, hub | reviewed |

Defects found and fixed during testing: weather error card overflowed its box; and a **pre-existing** bug in `hub/boot.js`
where "open this plugin" sent while the hub window was still starting was lost and the hub showed Tasks instead
(reproduced 4/4 on the original commit; 6/6 correct after the fix).

Test honesty notes: the weather *success* path and the error paths were exercised with injected IPC fixtures because the
sandbox has no internet (the live boot-time failure also rendered correctly as "Location unavailable"). Volume,
brightness and media were simulated by sending the IPC events the PowerShell watchers emit. `performance.memory` is
coarse, so the heap result is indicative only. Idle CPU is software-rendered Linux, not a Windows figure.

## 8. Known issues and limitations
- The island body is solid, not acrylic: a transparent, rounded, click-through Electron window cannot show real
  acrylic behind its shape. Acrylic stays on the hub window (Windows 11 22H2+), with the solid fallback on Windows 10.
- Weather location comes from the IP address (existing behaviour), so there is no permission prompt and no "permission
  denied" state; failures are shown as "Location unavailable" instead.
- The battery chip reads `navigator.getBattery()` as before. Desktop PCs without a battery report 100% and charging.
  It can be hidden with Settings > Show battery.
- The island window is not focusable (existing design), so it cannot be keyboard-navigated; controls still carry labels
  and focus styles.
- The Light theme works but received the least design attention.
- The focus-session counter label changed from "today" to "completed" because it was never saved across restarts.
- Weather condition table exists in both `shared/weather.js` and the Weather plugin (left alone to avoid rewriting a
  working plugin). Merging them is easy later.
- Internal identifiers deliberately keep the old name: `window.eyeland` bridge, `ey:` IPC channels, PowerShell class
  names, `package.json` name, `appId` (`com.eyeland.app`, kept so installs upgrade in place), the `%APPDATA%\eyeland`
  data folder, and the `Eyeland` / `Eyeland Received` folders in Downloads. Renaming these would orphan user data and
  touch every plugin; they are not user-visible except folder names.

## 9. Windows-specific testing still required (NOT verified)
Real Windows 10 and 11 launch; transparency and shadows on a real desktop; high-DPI and multi-monitor placement; real
volume and brightness keys and the WMI/CoreAudio watchers; media session (GSMTC) data; fullscreen auto-hide;
Windows 11 acrylic on the hub; tray icon rendering; global shortcuts; every screen-capture plugin (text, lens, colour,
draw, translate); `npm run dist` / the NSIS installer (the packaging step reached `Liquid Island.exe` and the asar
contained all new files, then stopped with "wine is required" for resource editing, which is an environment limit);
upgrade over an existing Eyeland install (shortcut and Run-key replacement, a stale old "Eyeland" login item is possible);
real-GPU CPU and memory.

## 10. Run it
```bash
npm install
npm start
```
Windows installer: `npm run dist` (run on Windows). UI harness: see `tools/ui-harness/README.md`.
