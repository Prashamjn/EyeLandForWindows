# Phase 3: how to test on Windows 11

Everything below needs a real Windows 11 PC. Nothing in this guide has been run on Windows yet. Run it from the repository root in
PowerShell. Where a step produces a file, send it back: `diagnostics\*.json` and `diagnostics\hover-*.log` (they contain device names
and file paths: skim them before sharing).

## 0. Get the code
```powershell
git fetch <path-to-bundle> feature/phase-3-dynamic-feedback-audio-studio-p234:feature/phase-3-dynamic-feedback-audio-studio-p234
git switch feature/phase-3-dynamic-feedback-audio-studio-p234
npm install
```

## 1. Automated checks (about 2 minutes)
| Command | Expected |
|---|---|
| `npm run test:unit` | `# fail 0`. On Windows this is the first time the real-FFmpeg tests run against the Windows FFmpeg build, and the C# compile test is skipped (no `mcs`), so use step 2 for C#. |
| `.\tools\windows\compile-native.ps1` | `All native C# compiled.` Phase 3 added no C# files, but `af52db1` was never run on Windows. |
| `npm run diag:audio` | `21/21 checks passed` (fewer format lines if this FFmpeg build lacks Opus or Vorbis; MP3, WAV and FLAC are required). |
| Push the branch | The `windows-native` workflow runs the same on a real Windows runner (it has never run before). |

## 1b. If Now Playing or the charger is not working
Start the app from a terminal (`npm start`) and keep it visible: charger decisions print as `[charge] ...` and helper problems as `[media.ps1] ...`.
| Check | Command | What it tells me |
|---|---|---|
| Does Windows report the playing media? | Play a song, then `.\tools\windows\probe-media.ps1` | Prints each message the helper sends. `RESULT: ... NOTHING` or an exit means the helper itself is the problem; messages here but nothing in the island means the app side. Send the output. |
| Does the power helper see the charger? | `node tools\windows\diagnose.js --watch 60`, plug and unplug during it | Lists the power events that arrive. Send the JSON. |
| Why was there no chime? | Plug in with `npm start` running | Look for the `[charge]` line (it names the reason). |

## 2. Hover, expansion and collapse
```powershell
.\tools\windows\run-hover-log.ps1
```
It prints `UIEffectsEnabled` and your displays, then starts the app with the trace on. Do the steps in order, then quit the app from the tray.

| # | Do | Expected |
|---|---|---|
| 1 | Move the cursor onto the pill. | After about 0.12 s it grows in one smooth shape (width, height, corner radius together). No bounce. |
| 2 | Move the cursor off the island. | About 0.35 s later it shrinks back to the pill. |
| 3 | Repeat #2 from: Home, every dashboard tab, Control Centre, Plugins > Audio Trimmer, Plugins > Audio Merger, Settings, Calculator. | It collapses from every one. (Before Phase 3 a plugin or the Control Centre never collapsed.) |
| 4 | With it open, move across the header, nav bar, cards and edges. | Never collapses while the cursor is on the visible island. |
| 5 | Leave and come back within a quarter of a second. | Stays open. |
| 6 | Click an app that sits under the *transparent* area around the island (left or right of the pill, and below the open panel). | The app gets the click: transparent margins are not interactive. |
| 7 | Click the lock icon (top right of Home, or in a workspace header), then move away. | Stays open. Click the lock again, or press Esc on Home: collapses. Restart the app: not locked. |
| 8 | Audio Trimmer: click the drop zone (native file dialog opens), move the cursor away while it is open. | Island stays open while the dialog is open. Cancel the dialog: it collapses about 0.35 s later (cursor away). |
| 9 | Audio Trimmer: start an export of a long file, move the cursor away. | Stays open until the export finishes or is cancelled. |
| 10 | Settings > Hover behaviour: turn off "Expand on hover", hover, then click the pill. | Hover does nothing; the click opens it. Turn it back on. Try "Collapse when the cursor leaves" off, and the delay slider (100 to 2000 ms). |
| 11 | Native Windows prompts that Electron does not own (for example the Wi-Fi location prompt in the Control Centre). | **Known limitation:** these cannot be detected. The island may collapse on window-blur after the "Collapse after (s)" time (Settings > Behaviour, default 8 s). Tell me what you see. |
| 12 | Two displays: put the island's display and the cursor on different monitors; if your monitors use different scaling, hover the very edge of the pill on each. | No flicker; the hover area matches the visible island. The log records the display id and scale for every zone change. |

**Motion check (the "no satisfying hover animation" complaint):** open Settings > Motion. If it says *Windows animation effects are off*,
that was the cause: Chromium reports reduced motion and the old stylesheet silently removed every animation. Either turn on
Windows Settings > Accessibility > Visual effects > Animation effects, or set Animations to **Always animate**. Flip the Windows switch
while the app runs: the status line should change by itself.

Send me `diagnostics\hover-*.log`.

## 3. Audio Studio (by ear and by eye)
1. Audio Trimmer: drag an MP3 from Explorer onto the page (and try Browse). Name, size, duration, format and tags appear; the waveform draws.
2. Drag the blue markers; type `1:05`, `65` and `0:01:05` into Start. Play, pause, stop, click the waveform to seek.
3. Turn on Fade in and Fade out, play "Selection only": you should *hear* the ramps. Export as MP3 and WAV, open the files in another player: length and fades match.
4. Try M4A, OGG and Opus. Any format this FFmpeg build cannot write is not offered.
5. Audio Merger: add 3 or more tracks (drag several files at once). Reorder with the arrows and by dragging. Set a Crossfade between two (smooth and linear), a Fade between the next two. The timeline total must equal the exported length. Try to enter a transition longer than a neighbour: it is limited.
6. Export during which you press Cancel: no half-written file remains in the output folder, originals are unchanged.
7. Default output folder is `Music\Liquid Island` unless changed in Settings > Audio Studio.

## 4. Media and lyrics
1. Play something in Spotify, or YouTube Music in Edge/Chrome. Expand the island: title, artist, app name, artwork, and the previous / play / next buttons (disabled when the player does not offer them).
2. Collapsed: three thin bars animate while playing, settle when paused, disappear when the player closes.
3. Settings > Media > Synced lyrics (off by default; it sends the track name to lrclib.net): at most one line appears under the artist while the song plays, in time with the music. If the player gives no position, or LRCLIB has no timestamped lyrics, you get a quiet "No synced lyrics" note. **Not yet known:** how accurately YouTube Music reports its position; tell me if the line drifts.

## 5. Charger sound
Unplug and plug the charger: one soft two-note chime per plug-in (none on unplug unless enabled), none while it stays connected. Settings > Charging: toggle, volume, disconnect sound. It stays silent when Windows is muted or battery notifications are off.

## 6. Control Centre (Priority 1) is still unverified
Run `node tools\windows\diagnose.js --all` and `--watch 90` as before and send the JSON. Phase 3 did not change Control Centre logic beyond holding the island open during long calls.
