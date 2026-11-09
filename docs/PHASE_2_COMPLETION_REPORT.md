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

## 15. Windows 11 test plan

Everything in sections 5-7 that touches Windows is **written but unverified on hardware**. This section is the complete, ordered plan
for verifying it. Please keep the simulated helpers **out** of these tests (see 15.2).

### 15.1 Requirements: administrator rights, hardware, extra software
| Need | Detail |
|---|---|
| OS | Windows 11 (the power-mode APIs are Windows 11 only; the rest should work on Windows 10, untested) |
| Software to install | Git, Node.js **22 LTS** (needed for the `node --test` glob in `npm run test:unit`; Electron 33 is downloaded by `npm install`), a terminal. Windows PowerShell 5.1 is built in and is **required** (the helpers run in `powershell.exe`; WinRT does not work in PowerShell 7). Proton VPN for Windows only for test 7 |
| Administrator rights | **None are intended.** Run everything as a normal user first. Suspects that may need elevation (please test both ways and tell me): **(a) joining a *new* Wi-Fi network**: the helper saves an all-user profile (`WlanSetProfile` flags 0), which can fail with "code 5" (access denied) for a standard user; the fix would be a per-user profile (flag `2`, one line in `native/cs/Wlan.cs`). **(b) the brightness slider**: `WmiSetBrightness` works unelevated on most laptops but some OEM drivers require admin. Joining a *saved* network, Bluetooth, audio, power mode and radio switches should not need admin |
| Privacy permission (not admin) | *Settings > Privacy & security > Radios* must allow apps to control radios, or the Wi-Fi/Bluetooth switches report "Windows is blocking radio control". *Settings > Privacy & security > Microphone* is **not** needed (no audio is opened) |
| Hardware | Wi-Fi adapter (Wi-Fi tests); Bluetooth radio **and** a Bluetooth headset/earbuds that you can power off (Bluetooth, audio-switch tests); a second sound output (headphones, HDMI/USB audio) for output switching; a **laptop with a battery and built-in screen** for battery, charger, power-mode-on-battery and brightness tests (a desktop only shows "No battery" and hides brightness, which is also worth checking); a microphone; a **second monitor** for multi-monitor tests (a single monitor still covers most of the placement tests) |
| Additional accounts / services | A second Wi-Fi network you can join, ideally a new WPA2 one with a known password and one you can deliberately mistype; Proton VPN installed and a Proton account (the app does the login, this app never touches it) |
| Antivirus | PowerShell scripts that compile C# at start-up (`Add-Type`) can trigger heuristics in some AV/EDR products. If a helper never starts, check the AV log |

### 15.2 Setup, tests and logging (copy and paste; PowerShell or Windows Terminal)
```powershell
git clone <your-local-repo> ; cd <your-local-repo>        # or use your existing clone
git checkout feature/phase-2-embedded-plugins-control-center
npm install
npm run test:unit                      # Node unit tests: 19 expected to pass (no Windows APIs involved)
npm start                              # runs the real app with the REAL PowerShell helpers
```
**Make sure the test-only switch is not set**, otherwise the app silently uses the simulated helpers:
```powershell
echo "LI_NATIVE_MOCK=[$env:LI_NATIVE_MOCK]"     # must print empty brackets: LI_NATIVE_MOCK=[]
Remove-Item Env:LI_NATIVE_MOCK -ErrorAction SilentlyContinue ; Remove-Item Env:LI_MOCK_CTL -ErrorAction SilentlyContinue
```
`LI_NATIVE_MOCK` (read in `src/system/index.js` / `helper.js`) exists only so the UI tests can run on Linux; the real helpers are the default and nothing in the app sets it.
Watch the terminal that runs `npm start`: each helper writes `[native:audio]`, `[native:net]`, `[native:bt]`, `[native:power]` lines to stderr.
`Add-Type failed: ...` means the C# did not compile on the real compiler (send me the full line).

Optional UI scenarios on Windows (the plugin and geometry scenarios do not need the simulated helpers; **never run `07-control-centre` on Windows, it asserts simulated data**; this harness has not been run on Windows before):
```powershell
$env:LI_SCRIPT = "$PWD\tools\ui-harness\scenarios\04-plugins-embedded.js" ; $env:LI_OUT = "$PWD\shots" ; npx electron tools/ui-harness/run.js
$env:LI_SCRIPT = "$PWD\tools\ui-harness\scenarios\08-geometry-and-interaction.js" ; npx electron tools/ui-harness/run.js
Remove-Item Env:LI_SCRIPT, Env:LI_OUT
```
**Poking a helper by hand** (best way to isolate a native problem; type a line and press Enter, `Ctrl+C` to quit):
```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\native\audio.ps1
{"rid":1,"cmd":"get"}
{"rid":2,"cmd":"setVolume","value":30}
```
Same for `net.ps1` (`get`, `networks` with `"rescan":true`, `vpn`), `bt.ps1` (`get`, `scan` with `"seconds":10`), `power.ps1` (`get`, `setMode` with `"mode":"balanced"`). Replies are `{"rid":N,"ok":true,"data":...}` or `{"rid":N,"ok":false,"error":"...","code":"..."}`; unprompted lines `{"ev":...}` are events.

### 15.3 Ordered checklist
Mark each item PASS / FAIL / N-A and note the exact on-screen text or terminal line for any FAIL. Order matters: earlier items prove the basics the later ones rely on. The Control Centre opens from the toggle-switches icon (third from the left) in the bottom navigation, or from the tray menu (*Open Control Centre*).

**A. Start-up and baseline**
1. `npm start`: capsule appears centred, **10 px below the top edge**, full pill shape. No `Add-Type failed` or red errors in the terminal. Wait ~10 s (helpers start staggered; notifications are suppressed for ~8 s).
2. Hover the capsule: it expands to the dashboard. Move away: it closes. Open Task Manager and note the app's CPU and the number of `powershell.exe` children (expect 6 at most: audio, net, bt, power, sys, media). Note start-up CPU for the first 10 s and idle CPU after a minute.
3. Open the Control Centre. Every tile should say something real within a few seconds (not "Loading…" and not "Unavailable"). Note any tile that stays "Unavailable" and which helper line in the terminal matches.

**B. Volume, mute, microphone (Core Audio)**
4. Drag the Volume slider: Windows' volume flyout shows the same number. Press the keyboard volume keys: the slider and the number follow within about a second.
5. Mute button: Windows shows muted; press the keyboard mute key: the button follows.
6. Microphone tile: shows your default recording device. Toggle its switch: Settings > System > Sound > Input shows the device muted; toggle in Windows: the tile follows and a "Microphone muted/on" notice appears. Check Windows' microphone-in-use indicator **never** appears because of this app.

**C. Sound output switching (uses the undocumented `IPolicyConfig`)**
7. Open "Sound output": all active output devices are listed, with the default marked.
8. Click another device: the **Windows Settings > System > Sound > Output** default really changes (play audio to hear it), the Control Centre marks it, and a "Switched to <device>" notice appears. Switch back.
9. Plug in headphones (or switch a Bluetooth headset on): "<device> connected" notice and the list updates. Unplug: "<device> disconnected" and the default falls back. Confirm the headphone icon appears for headphones/headsets (not only by name).
10. Try switching while audio is playing; verify no crash in the terminal. Report which device types worked (speakers, headphones, HDMI, Bluetooth).

**D. Wi-Fi (Native Wifi API)**
11. Wi-Fi tile shows your current network; open the pane: a list of nearby networks with signal bars, your network marked "Connected".
12. Toggle the Wi-Fi switch **off**: Windows' Wi-Fi turns off (check the taskbar), notice "Wi-Fi disabled". If you see "Windows is blocking radio control", enable Settings > Privacy & security > Radios and retry. Toggle **on**: "Wi-Fi enabled".
13. Connect to a **saved** network (one Windows already knows) by clicking it: "Connecting to network…" then "Connected to <name>" only when Windows reports it.
14. Connect to a **new WPA2 network**: click it, the password box appears, enter a **wrong** password: expect "Could not connect…", the previous state unchanged, and nothing shown as connected. **If you see "Windows rejected the network settings (code 5)", note it: that is the all-user profile / admin suspect above; retry once from an elevated app (Run as administrator) and tell me whether it then works.**
15. Repeat with the **correct** password: connects, notice shown. Confirm in Windows Settings that the profile exists (that is expected; the app does not store the password).
16. Click an enterprise (802.1X) network if one is nearby: expect the "work or school account" message, no connection attempt. Click **Disconnect**: "Disconnected from Wi-Fi".
17. Check the password is never written to the terminal while doing steps 14-15.

**E. Bluetooth (WinRT + `BluetoothSetServiceState`)**
18. Bluetooth tile and pane: radio state correct; paired devices listed with the correct connected/paired state (compare with Settings > Bluetooth & devices).
19. Toggle the switch off/on: Windows follows, notices "Bluetooth disabled/enabled".
20. Headset **Connect** (headset powered on, paired, currently disconnected): "Connecting…" then connected **only** after Windows confirms; notice "<name> connected". Audio output may switch to it (check 9).
21. **Disconnect** the headset from the app: it disconnects, notice "<name> disconnected". Watch for 30 s: **does the headset reconnect by itself?** (known risk; report yes/no and the headset model).
22. Power the headset off and on by hand: notices appear for both without clicking anything in the app (event-driven path).
23. **Search** with a device in pairing mode: it appears under "Add a device"; **Pair** it. If Windows shows its own pairing prompt, report what it asked. Low-energy device (mouse/keyboard) rows must show "Auto" instead of a Connect button.

**F. Proton VPN (observation only)**
24. With Proton VPN **not running**: VPN tile says "Proton VPN · Off", pane says "Not running", button reads "Start Proton VPN". Click it: the Proton VPN app launches.
25. Connect inside the Proton app: within a few seconds the tile becomes "Connected" and a "Proton VPN connected" notice appears. Disconnect in the Proton app: "Proton VPN disconnected". If it never turns to Connected, run `Get-NetAdapter | Select Name, InterfaceDescription, Status` and send me the Proton adapter's **Name** and **InterfaceDescription** (the detection matches "protonvpn"/"proton vpn" in either; I only need to widen it).
26. Confirm the app never asks for or shows Proton credentials, server names or locations.
27. If Proton VPN is not installed on a test PC: tile says "Proton VPN not installed"; never "Connected".

**G. Battery, charger, power mode, brightness (laptop)**
28. Battery tile and pane: percentage matches the taskbar; "Charging"/"On battery"/"Plugged in" correct; time remaining shows only on battery.
29. Unplug and plug the charger: notices "Charger disconnected/connected <n>%" within a couple of seconds. (Percentage itself refreshes about once a minute.)
30. Power mode: all three modes listed; click one: the setting really changes in Settings > System > Power & battery > Power mode, and the notice appears. Try each on AC and on battery. If Windows refuses one on your device the row must **not** become current; send me the error text.
31. Brightness slider: moves the built-in panel; press Fn brightness keys: slider follows. On a desktop or an external-monitor-only setup the brightness row must be hidden. If setting brightness fails, retry elevated and tell me.

**H. Displays and multi-monitor positioning**
32. Displays pane lists each monitor with resolution, refresh rate (not "?") and scale. Compare with Settings > System > Display.
33. Single monitor: set *Settings > Top gap* to 0, 10 and 30 px: the capsule moves accordingly; at 0 it docks flat to the edge. Check at display scaling 100%, 125% and 150%: the gap should look the same.
34. Set *Settings > Edge* to Bottom: capsule sits at the bottom with the same gap and grows upward. Set back to Top.
35. **Second monitor** (if available): *Settings > Display* lists both; choose the secondary: the capsule moves to the centre-top of that monitor. Unplug it: the capsule returns to the primary and nothing is left off-screen; plug it back: it returns to the chosen monitor. Change a monitor's resolution: the capsule re-centres. Try monitors of different sizes and with the secondary on the left of the primary (negative coordinates). Note the "<monitor> connected/disconnected" notices.
36. Hover the 10 px strip at the very top edge: it opens. Make sure clicking things in the top 10 px or behind the transparent canvas still reaches other windows (click-through).
37. Run a full-screen app or game: the capsule hides; return: it reappears.

**I. Plugins and the embedded workspace (real data this time)**
38. Open each of the 20 plugins from the Plugins tab: it opens inside the capsule (no extra window), Back returns. Try the ones that touch Windows: Converter, Reducer and Print (native file/save dialogs: do they appear on top and work?), Voice Memos (microphone permission and recording), Text Extractor / Lens / Colour Picker / Draw (full-screen overlay appears; the result comes back inside the capsule), Translate scan, QuickShare, Speed Test, Temp Cleaner, YouTube downloader, System Monitor, Weather, Coffee mode.
39. Global shortcuts for the screen tools still work. Collapse behaviour: open a plugin, click another app: after ~8 s the island collapses; hover to reopen: the page is still there.
40. Windows with high DPI or a second monitor: any clipping or blur in the workspace.

**J. Settings and notifications**
41. Switch off one notification category (for example Wi-Fi) and trigger it: no notice, but the tile still updates. Switch it on again.
42. Quit and restart the app: settings, favourites, pins and the Top gap persist. Exit from the tray menu: no `powershell.exe` helper processes remain in Task Manager (check after 5 s).

### 15.4 What to send back
For each FAIL: the item number, what you did, what you expected, what happened (screenshot), the exact terminal lines from `npm start`, Windows 11 version (`winver`), whether you were elevated, laptop or desktop, and the device model for audio/Bluetooth issues. For a native problem, the output of the matching manual helper command in 15.2 is the most useful single thing.
Likely trouble spots, in the order I would look: COM vtable and struct layouts in `native/cs/Audio.cs` and `Wlan.cs`; `Register-ObjectEvent` with WinRT events in `native/bt.ps1`; the Wi-Fi all-user profile permission (item 14); `BluetoothSetServiceState` behaviour per headset; `PowerGetUserConfigured*` availability; a headset auto-reconnecting after disconnect (item 21).

## 16. Importing and reviewing
```powershell
# 1. Put liquid-island-phase2.bundle somewhere, then from inside your EXISTING local clone of EyeLandForWindows:
git bundle verify C:\path\to\liquid-island-phase2.bundle
git fetch C:\path\to\liquid-island-phase2.bundle "feature/phase-2-embedded-plugins-control-center:feature/phase-2-embedded-plugins-control-center"
git checkout feature/phase-2-embedded-plugins-control-center
git log --oneline -5                       # tip should match the hash in the delivery notes; main is not modified
```
No existing clone? `git clone C:\path\to\liquid-island-phase2.bundle EyeLandForWindows` then `git checkout feature/phase-2-embedded-plugins-control-center`.
The bundle contains only this branch (with its full history back to the first commit). It does not touch `main` and nothing is pushed anywhere.
Base: `main` @ `db695b2`. Commits on the branch: `1c41cc1` (native + system layer), `9d24f8a` (renderer, main, preload), `6543789` (tests, docs, first version of this report) and a final documentation-only commit that adds sections 15-16 (no source files changed; verify with `git diff 6543789..HEAD --stat`).
