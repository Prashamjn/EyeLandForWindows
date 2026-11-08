# Phase 2 completion report: embedded plugins, Control Centre, device notifications

Branch `feature/phase-2-embedded-plugins-control-center`, based on `main` @ `db695b2` (merge of PR #1, Phase 1). Not pushed.

## 0. Read this first: what is and is not verified

I worked in a Linux sandbox. **I had no Windows machine.** That splits this report into two honest halves.

**Verified here (real code, real Electron under Xvfb):** the embedded plugin architecture, all 21 plugin pages mounting inside the
island, navigation, the Control Centre UI, IPC, argument validation, the helper process manager, notification rules, settings
migration, window placement, hit-testing, pinning/focus, motion. The native helpers were **simulated** with Node mocks that speak the
real protocol (`tools/ui-harness/mock-native`), so the *app's* behaviour around them is tested, but not Windows' behaviour.

**NOT verified (needs Windows 11 hardware):** every call into a real Windows API: Core Audio, the default-output switch, Native Wifi,
WinRT Bluetooth/radios, `BluetoothSetServiceState`, power-mode APIs, WMI brightness events, the Proton VPN adapter detection. For these I
could only (a) check that the PowerShell parses (`pwsh` parser on all `.ps1`) and (b) compile the C# with `mcs -langversion:5` (the
dialect Windows PowerShell 5.1's `Add-Type` accepts). **Compiling proves the P/Invoke/COM declarations are syntactically valid, not that
the vtable layouts and struct sizes are right.** Treat every Windows integration below as "written, untested on hardware" until you
run section 15's checklist. I would expect to fix a few things in the first real run.

## 1. Summary
Liquid Island is now a single window: dashboard, 21 plugin pages and a new Control Centre all live inside the capsule. The old plugin
hub window, its HTML, boot script and stylesheet are deleted. Device events (Bluetooth, Wi-Fi, VPN, sound output, microphone, power
mode, displays, battery/charger) expand the capsule with a short notice. The window is now physically placed 10 px below the screen
edge. Native work moved from one 100 ms polling PowerShell loop to four on-demand, event-driven helper processes.

## 2. Phase 1 verification
- Branch `main`, HEAD `db695b2`, clean working tree. Phase 1 **is** in the repository (the PR was merged), so I built on it. The
  "public repo might lack Phase 1" concern did not apply.
- No eyes/mascot code remains (checked with grep). Phase 1 island, media, clock, weather, quick actions, sliders, nav all present.
- Findings that affected Phase 2:
  - `offsetY` existed (default 6) and was applied **only as a CSS `top`** inside a window that sat flush at the screen top. It "worked", but
    the window and the visible capsule disagreed, and a saved `0` made the island look glued to the edge.
  - Preload exposed `invoke/send/on` for **any** channel name.
  - Volume/brightness were a 100 ms PowerShell polling loop, and each slider move spawned a new PowerShell (with C# compile).
  - Scenario `00` called a global `openPanel()` that never existed even at Phase 1 (stale test, fixed).
  - Two copies of the Phase 1 report exist (`PHASE1_REPORT.md` at the root and in `docs/`), plus `liquid-island-phase1.bundle/.patch`. Left untouched.

## 3. Phase 1 corrections made
Top-gap geometry (section 8), preload allowlist, polling removed, stale scenario fixed, `toast`/settings now reach plugin pages
inside the same window. Default `offsetY` 6 → 10 with a one-time migration (section 8).

## 4. Embedded plugin architecture
```
Island shell (renderer/island.js)  states: compact | mini | full;  full has mode dash | work
 ├─ Dashboard (dashboard.js, panels.js)             mode "dash", 620x388
 └─ Workspace (workspace.js)                        mode "work", 700x500, hosts either
     ├─ Plugin page: Plugins.map.get(id).mount(root, ctx) -> cleanup   (renderer/plugin-host.js, renderer/plugins/*.js)
     └─ Control Centre (cc.js)
Navigation: route = dash | plugin(id) | cc(pane); back() / toDash() / escape(); one stack-free state, no history leaks
```
- The 20 plugins and the Shortcuts page are the **same files** as before (`git mv hub/plugins renderer/plugins`, history preserved). Their
  back ends in `src/` are untouched. The plugin contract (`mount(root, ctx)`, `ctx.ey`, `ctx.S`, `ctx.save`) is unchanged.
- `plugins.css` is the old hub stylesheet re-scoped under `.pw`, with explicit resets for the island's global `.btn/.card/.label/.empty`
  and range-input rules so plugin pages cannot leak into, or be broken by, the shell.
- **Settings sync:** the main process never echoes a change back to the window that made it, and plugin pages and dashboard now share a
  window, so there is an in-renderer bus (`LI.bus`) and `LI.S` is updated in place. This was a real bug caught by a test (a task added in
  the Tasks page did not appear on the dashboard).
- pdf.js and the QR library load on first use of the plugins that need them, not at start-up.
- Loading state (after 140 ms), error state with **Try again** (tested with a plugin that throws), and an unmount of the page on leaving.
- Pinning: while a page is open the island does not close on mouse-leave, the window becomes focusable (keyboard works, native
  file/save dialogs attach to it), and it collapses on Esc, Collapse, or after `blurCollapseSec` (default 8 s) without focus. The page is
  kept mounted when collapsed; *Settings > When opened* chooses "Resume last page" (default) or "Start at Home". Notifications never
  make the window focusable.
- Screen tools (Text, Lens, Colour, Draw, Translate): the **configuration and result pages are in the island**; the full-screen selection
  overlay remains a separate transparent window (allowed). Global shortcuts for these still launch the overlay directly. After a Translate
  scan, main sends `open-panel {plugin:'translate', payload}` and the page opens in the island with the text (tested).
- Plugin categories follow your list. Catalog `group` values changed, ids/names/shortcuts did not: Screen Tools, Productivity, Files &
  Utilities, Connectivity, System (Shortcuts page is under System). Favourites (star) adds a tab; Pin puts a plugin in the 4 Home quick actions.

## 5–7. Control Centre, APIs, direct control vs fallback
Legend: **D** = direct control, **R** = read-only status, **F** = fallback to Windows Settings / the vendor app.

| Feature | Mode | Windows mechanism | Notes |
|---|---|---|---|
| Volume, mute | D | Core Audio `IAudioEndpointVolume` + change callback | Keyboard/external changes arrive as events |
| Sound output list + switch default | D | `IMMDeviceEnumerator`, `IMMNotificationClient`; **`IPolicyConfig` (undocumented COM)** to set the default | No public API exists for switching. Same mechanism as Windows' Sound settings and SoundSwitch. Verified by name only |
| Brightness | D (built-in panels) | WMI `WmiMonitorBrightnessMethods` (kept from Phase 1) + `WmiMonitorBrightnessEvent` | Row hidden when unsupported. No external-monitor claim |
| Wi-Fi on/off | D | `Windows.Devices.Radios` (`Radio.SetStateAsync`, `StateChanged`) | Needs Settings > Privacy > Radios; error says so |
| Wi-Fi networks, connect, disconnect | D | Native Wifi API (`WlanScan`, `WlanGetAvailableNetworkList`, `WlanSetProfile`, `WlanConnect`, `WlanDisconnect`, `WlanRegisterNotification`) | WPA2-PSK, WPA3-SAE, open. 802.1X enterprise: **F** (explains, points to Windows). Password goes over stdin to the helper, is never logged, echoed or stored by the app (Windows stores the profile, as it does for any connection). Saved passwords are never read |
| Bluetooth on/off, list, state events | D / R | `Windows.Devices.Radios`; `BluetoothDevice.ConnectionStatusChanged`; `DeviceInformation` | 30 s safety re-read only |
| Bluetooth connect/disconnect | D (classic) | Win32 `BluetoothSetServiceState` (documented) toggling A2DP/HFP/HSP/AVRCP/HID | Success is reported **only** after `ConnectionStatus` confirms it. Low-energy devices: **not supported** (Windows offers apps no way); the UI says "Auto" instead of a fake button |
| Bluetooth discovery + pairing | D | `DeviceWatcher`, `DeviceInformation.Pairing.PairAsync` | Windows may show its own pairing prompt. Custom PIN/passkey confirmation UI is not implemented |
| Battery, AC, saver, time left | R | `GetSystemPowerStatus`, `SystemEvents.PowerModeChanged`, 60 s refresh | Percentage has no change event, hence the minute read. Time-to-full is not provided by this API |
| Charging | R | same | Status only, as specified |
| Microphone mute + device | D | Core Audio capture endpoint mute flag | **No stream is opened; no audio is read.** |
| Displays | R | Electron `screen` | Read-only; refreshes on display events |
| Power mode | D (Windows 11) | `PowerSetUserConfiguredACPowerMode` / `DC…` + `PowerGet…`, `PowerRegisterForEffectivePowerModeNotifications` (documented) | Mode is read back; one Windows refuses is **not** shown as active. Applies to the current power source |
| Night Light | **F** | `ms-settings:nightlight` | No supported API; status deliberately "not available". No registry hacks |
| Proton VPN | R + **F** | Registry uninstall keys, process names, `NetworkInterface` adapter state, `NetworkChange` events, Start-menu shortcut | See section 7a |

### 7a. Proton VPN findings
Searched Proton's support and docs: a command-line client exists for **Linux only**; for Windows there is the GUI app and no documented
CLI, API or URL scheme for connecting. Therefore: **detect and observe, never control.** Installed = uninstall registry entry or Start-menu
shortcut. Running = process name. **Connected = a network adapter whose name/description contains "ProtonVPN" is Up** (this is a system
fact, not scraped from the app). Never shown as connected when not installed (tested). Server/location are **not** shown: they are private
to the app and I will not scrape them. "Connect"/"Disconnect" buttons do not exist; "Open Proton VPN" launches the Start-menu shortcut.
The adapter-name heuristic is the main thing to confirm on your installed version; if Proton names it differently, `IsProton()` in
`native/cs/Wlan.cs` is the one-line fix. **"Connecting to Proton VPN…" cannot be detected**, so that notification is not implemented.

## 8. Island geometry and top gap
- The Electron window is now placed at `display.top + offsetY` (bottom edge: `display.bottom − height − offsetY`) and the capsule sits flush
  at the top of that window; the CSS `top` offset is gone. Tested: window `y = 10`, capsule `top = 0`, gap on screen 10 px.
- Canvas is a fixed 760×620 and is **never resized during animation** (sampled every 16 ms across compact → full → plugin → Control Centre → compact: one size throughout).
- With a gap > 0 all four corners are fully rounded (capsule/pill silhouette); at 0 the Phase 1 docked shape is used.
- The gap is part of the hover target, so slamming the cursor to the screen edge opens it (tested; 40 px above does not).
- **Displays:** *Settings > Display* picks a connected monitor (default primary). Removed/added/resized displays recompute placement and fall
  back to primary. This was tested **with a stubbed `screen` API**, not with two physical monitors.
- **Migration (settings v2):** only the old default values `offsetY` 0 or 6 (or missing) become 10, once. Any other value is kept. A file already
  at v2 is never touched. Tested on four settings files; everything else (theme, tasks, shortcuts, …) preserved.
  *Decision for you:* a Phase 1 user who deliberately chose 0 is moved to 10 once; they can set 0 again in Settings.
- Not handled: a display shorter than ~630 px would clip the bottom of the 500 px workspace.

## 9. Notification system
Pure rules in `src/system/notify.js` (unit-tested) turn a **real state change** into one notice: nothing on the first reading, nothing when
unchanged, identical notices within 4 s dropped, none for ~8 s after launch. Categories each have a Settings switch; duration is
configurable. Presentation: compact → mini pill (icon, title with the real device/network name, category, tone dot); dashboard → activity
area; workspace/Control Centre → banner. Implemented: Bluetooth radio/device, Wi-Fi radio/connecting/connected/disconnected/failed, VPN
connected/disconnected, sound output switched/added/removed (uses Windows' endpoint **form factor** to pick the headphone icon, not the name),
microphone, power mode, displays, charger, battery low (≤20 %) and critical (≤10 %, re-arm when charging). The Phase 1 "charging" toast was
removed to avoid duplicates. Charging sound/animation: not started (Phase 4).

## 10. Performance and reliability
- Helpers are per-domain and lazy; one failing helper cannot affect another; crashes restart with backoff and stop after 5 in 2 minutes
  (tested). They exit when the app closes their stdin (tested), so none can linger.
- No per-change process spawn: sliders talk to a long-lived helper (Phase 1 spawned PowerShell per move).
- Idle wake-ups: helpers block in `Wait-Event`; remaining timers are `sys.ps1` full-screen check (500 ms, was 100 ms plus audio/brightness),
  battery read (60 s), Bluetooth safety re-read (30 s). The Phase 1 33 ms cursor poll is unchanged.
- **I measured nothing on Windows**: no CPU, memory or startup figures. Each PowerShell helper compiles its C# at start (expect ~1–3 s of
  csc each, staggered 700 ms apart). Measure this.
- Monitoring can be switched off per area in Settings (Sound/mic, Wi-Fi/VPN, Bluetooth, Battery/power); opening the Control Centre still loads state on demand.

## 11. Security
Context isolation on, node integration off (tested: no `require`, `process`, `ipcRenderer` in the page). Preload now allows only `ey:*`/`ov:*`
plain channel names plus three named settings channels (an unlisted channel is rejected, tested), and the Control Centre is a fixed list of
20 operations. Main validates every argument again (`validate.js`): numbers clamped, booleans strict, `null` rejected, device ids matched
against strict patterns, SSID length checked in bytes, security type whitelisted, password limited. Helpers never use shell strings: arguments
are JSON-parsed and passed to APIs; Wi-Fi XML values are escaped. Requests are never logged. CSP now allows only what plugin pages need (`blob:`/`https:` images, `blob:` media/workers).
`ey:*` is still a broad namespace (about 50 handlers) because the 20 plugins need it; narrowing it per plugin would be a Phase 3+ refactor.

## 12. Files
**Modified:** `main.js`, `preload.js`, `package.json`, `README.md`, `native/sys.ps1` (now only full-screen + media keys), `shared/catalog.js`, `shared/icons.js`, `src/capture.js`,
`renderer/{app,core,dashboard,island,panels}.js`, `renderer/{dashboard,island}.css`, `renderer/index.html`, `tools/ui-harness/README.md`, scenarios `00`, `03`, `05`.
**Moved (git mv):** `hub/hub.js` → `renderer/plugin-host.js`; `hub/plugins/*.js`, `hub/vendor/`, `hub/calc-engine.js`, `hub/qr-render.js` → `renderer/plugins/`.
**Deleted:** `hub/index.html`, `hub/boot.js`, `hub/hub.css`, scenario `04-plugins-integration.js` (replaced).
**Added:** `native/{audio,net,bt,power}.ps1`, `native/lib/{common,winrt}.ps1`, `native/cs/{LiIO,Audio,Wlan,Bluetooth,Power}.cs`, `src/system/{index,helper,validate,notify,display}.js`,
`renderer/{workspace,cc,notify}.js`, `renderer/{workspace,plugins,cc}.css`, `tools/tests/*.test.js`, `tools/ui-harness/mock-native/*`, scenarios `04-plugins-embedded`, `07-control-centre`,
`08-geometry-and-interaction`, `09-settings-migration`, `docs/phase2-screenshots/*`, this report.

## 13. Tests and actual results (final code state)
| Suite | Result |
|---|---|
| `npm run test:unit` (notify rules, validation, helper protocol incl. crash/timeout/orphan, `id`-collision regression) | 19 / 19 |
| `04-plugins-embedded` (all 21 plugin pages in-island, one window, Back/Home/Esc, functional checks on Tasks/Calculator/QR/Print, favourites, pins, error state, Translate delivery, toast banner) | 24 / 24 |
| `07-control-centre` (simulated helpers: tiles, sliders, output switch, Wi-Fi password flow incl. wrong password, Bluetooth connect/pair/disconnect, VPN states, power-mode refusal, battery, mic, notifications, category off, de-dup, validation, security) | 69 / 69 (twice in a row) |
| `08-geometry-and-interaction` (gap, silhouette, bottom edge, simulated displays, no resize, morph sampling, focus, hit-test, blur-collapse, motion) | 31 / 31 |
| `09-settings-migration` (4 settings files) | 7 + 4 + 4 + 3, all pass |
| Phase 1 regressions `03` / `05` / `06` (updated for the intentional geometry/migration changes) | 21 / 5 / 5 |
| `00`, `01`, `02` (screenshot scenarios) | ran without errors; reviewed by eye |
| `.ps1` parse (`pwsh` parser) / C# 5 compile (`mcs`) | all scripts parse, all `.cs` compile |

Defects the tests caught and I fixed: request-id collision with device-id arguments (would have broken Bluetooth and output switching on
Windows); password field keeping focus and blocking repaint after Connect; settings not reaching the dashboard from plugin pages;
`null` accepted as volume 0; battery alerts not re-arming; headphone icon chosen by name; mock helper replaying stale events; test-only issues in my scenarios.
Screenshots are in `docs/phase2-screenshots/` and show **simulated data**.

## 14. Not implemented / limits
- Proton VPN connect/disconnect, server/location, "Connecting…" notice (no supported interface).
- Night Light status and control (no supported interface).
- Bluetooth low-energy connect/disconnect; custom pairing PIN UI; Wi-Fi 802.1X; hidden networks; forgetting networks.
- External-monitor brightness; display configuration changes.
- Time-to-full for charging.
- Keyboard navigation is partial: tiles and rows are focusable, Enter activates rows, Esc steps back; I did not do a full tab-order and screen-reader pass.
- Real animation smoothness on Windows GPUs was not measured (only frame-sampled the layout in Chromium under software rendering).

## 15. Windows verification checklist (please run, in this order)
1. `npm install && npm start` on Windows 11. Watch the terminal for `[native:audio|net|bt|power]` lines; any `Add-Type failed` is a C# compile problem on real csc.
2. Volume slider, mute, keyboard volume keys; **switch output to a second device**; unplug/plug headphones (expect the notice).
3. Wi-Fi: toggle, scan, connect to a saved network, connect to a new WPA2 network, wrong password, disconnect.
4. Bluetooth: toggle, paired list, connect/disconnect a headset, search + pair a device, turn a device off (expect the notice).
5. Power mode switch on a laptop on AC and on battery; battery/charger notices.
6. Brightness slider, then Fn keys (slider should follow); row hidden on a desktop.
7. Proton VPN: connect in its app, confirm the tile and notice follow; if not, check the adapter name (`Get-NetAdapter`).
8. Top gap on your real display(s), DPI scaling 100/150 %, a second monitor, and a full-screen game (island should hide).
9. Open each plugin once; try file pickers (Converter, Reducer, Print), Voice memo recording, screen tools + overlay, Translate scan.
Likely trouble spots: COM vtable/struct layouts in `Audio.cs`/`Wlan.cs`, `Register-ObjectEvent` on WinRT events in `bt.ps1`, `BluetoothSetServiceState` behaviour per headset,
`PowerGetUserConfigured*` availability, and a headset that auto-reconnects right after the app disconnects it.

## 16. Running and reviewing
```bash
git checkout feature/phase-2-embedded-plugins-control-center
npm install && npm start                      # Windows 11 for the real Control Centre
npm run test:unit                             # no Electron needed
# UI scenarios (Linux/CI, simulated helpers): see tools/ui-harness/README.md
git log --oneline main..HEAD                  # review in 3 commits
```
Branch `feature/phase-2-embedded-plugins-control-center`; base `db695b2`; commits: `1c41cc1` (native + system layer), `9d24f8a` (renderer, main, preload), and the tests/docs commit that contains this file. **Nothing has been pushed.**
