# Phase 3, Batch 2: Control Centre repair

Branch `feature/phase-3-dynamic-feedback-audio-studio` · 9 commits on top of `origin/main` (`7ca6501`): Batch 1 audit, seven implementation commits (2.1 to 2.7) and this report · **nothing pushed, nothing merged**
Scope: Control Centre only. No hover system, Audio Studio, media or charging work was started.

## 0. Verification vocabulary (used for every item below)

| Label | Meaning |
|---|---|
| **Implemented** | The code exists in this branch. |
| **Compiled** | The C# compiles with Mono `mcs` at C# 5 (the language level of Windows PowerShell 5.1). **Mono is not Windows `csc`**, so this is a strong hint, not proof. The CI job (item 7) is the real check. |
| **Parsed** | Every `.ps1` passes the PowerShell 7 parser. |
| **Tested (Linux)** | An automated test ran here. The test's scope is stated each time. |
| **Windows verified** | Run on a real Windows machine. **Nothing in this batch is Windows verified.** |

**What I could not do in this environment:** run Windows, Windows PowerShell 5.1, any Windows API (Wlan, Core Audio, Bluetooth, WMI, WinRT), or hardware. Everything that touches those is *implemented, compiled, not Windows verified*. I did not assume any result from your diagnostic: **you have not sent one yet.**

Tools I did get working in the sandbox, which Batch 1 did not have: Mono `mcs`, PowerShell 7.4 (parser, and a runtime for pure PowerShell/C# logic), and Electron under xvfb for the existing UI harness.

## 1. Summary

| # | Item | Findings | Implemented | Compiled | Tested (Linux) | Windows verified |
|---|---|---|---|---|---|---|
| 1 | Error transport | F2, F3, F9 | yes | yes | **yes, real PowerShell run, bug reproduced then fixed** | no |
| 2 | Wi-Fi | F1, F4, F5, F6 | yes | yes | Node logic only | no |
| 3 | Sound output | F7, F8 | yes | yes | Node logic only | **native switch yes (diagnose, section 13)**; in-app path not yet |
| 4 | Authoritative refresh | F14 | yes | n/a | yes (lying-helper tests) | no |
| 5 | Bluetooth | F10, F11 | yes | yes | no (WinRT only) | no |
| 6 | Proton VPN | F13 | yes | yes | no | no |
| 7 | Windows CI | n/a | yes | n/a | YAML parses; **never run** | no |
| 8 | Native events | your radio-events error | yes | yes | bridge tested with WinRT-shaped fakes | no |

Automated results: **35/35 unit tests**, Electron UI scenario 07 (Control Centre) **69/69**, scenarios 03, 04, 06, 08 all pass (00, 01 and 02 only take screenshots / contain no assertions); 05 and 09 fail identically on untouched `origin/main` (harness setup, not caused by this batch, see section 12).

## 2. Your radio-events error, identified exactly (item 8)

`[native:net] radio events unavailable: Windows PowerShell cannot subscribe to Windows RT events.`

**Where:** PowerShell's `Register-ObjectEvent` cmdlet cannot attach to Windows Runtime objects. Phase 2 used it at **four** places, and they failed differently:

| Phase 2 site | Subscribes to | Consequence |
|---|---|---|
| `net.ps1:12` | Wi-Fi `Radio.StateChanged` | logged the message you saw; manual Wi-Fi changes never reached the UI |
| `bt.ps1:60` | Bluetooth `Radio.StateChanged` | **no message at all** (empty `catch`) |
| `bt.ps1:30` | per-device `ConnectionStatusChanged` | threw *after* the device was cached but *before* it was added to the list: the **first** paired-device list was always empty |
| `bt.ps1:83` | discovery `DeviceWatcher` Added/Updated | threw inside `scan`: **Bluetooth discovery could never have worked** |

These are code-reading conclusions from your error message plus the source; I could not reproduce them without Windows.

**What I investigated and chose**

* *WLAN notification callbacks* (Wi-Fi): documented Win32. `WlanRegisterNotification` with the ACM and MSM sources; MSM code 7 is `radio_state_change`. Wi-Fi radio state is also readable with `WlanQueryInterface(radio_state)`. This removes Wi-Fi's need for WinRT events entirely.
* *Compiled C# subscribing to WinRT events* (Bluetooth): the CLR projects WinRT events as ordinary .NET events, so compiled code can subscribe where PowerShell cannot. Compile-time `.winmd` references are fragile under Windows PowerShell's legacy compiler, so `native/cs/WinRtEvents.cs` (`LiWinRt`) attaches **by reflection** and re-raises each event on `LiHub`, an ordinary .NET event that PowerShell can wait on.
* *Win32 Bluetooth notifications*: there is no documented app-level notification for radio power or connection changes; rejected.
* *Polling*: kept **only as a recorded fallback**, see below.

**Idle cost:** no polling while events work. Bluetooth keeps a 2-minute full re-listing as a safety net. If any WinRT subscription fails, the exact reason is recorded (`state.events`, `state.eventErrors`, a `[cc] bluetooth events:` log line), and only then a 5-second status read starts. During a discovery scan whose events fail, results are read every 3 s for the length of that scan only.

**Tested:** `tools/tests/native-events.test.js` runs the production `LiWinRt` + `LiHub` + PowerShell loop against WinRT-*shaped* fakes (generic `TypedEventHandler`-style delegates). It proves the delegate binding, the signal bridge, unsubscribe and failure reporting. **It does not prove the real WinRT projection accepts `EventInfo.AddEventHandler`.** That is the single biggest unknown in this batch; `diagnose.js` reports it directly (section 11).

## 3. Item 1: Error transport (F2, F3, F9)

* **Original problem:** errors from Windows reached the UI as `failed` with an unreadable `Exception calling "Connect" with "4" argument(s)…` prefix; real failures were reported as "no radio"; brightness failures were hidden.
* **Root cause:** (F2) PowerShell wraps exceptions thrown inside .NET methods in `MethodInvocationException`, so `$_.Exception -is [LiError]` was false for every error thrown from C#. (F3) `Get-LiRadio` had a catch-all returning `unsupported`. (F9) several `catch {}` / `SilentlyContinue`.
* **Files:** `native/lib/common.ps1`, `native/lib/winrt.ps1`, `native/power.ps1`, `native/cs/LiIO.cs`, `src/system/{helper,index,errors,validate}.js`, `preload.js`, `renderer/cc.js`.
* **Implementation:** `Get-LiFault` walks `InnerException` to the real error and classifies it (typed, COM with HRESULT, access denied). Replies carry `code`, a readable message and a `detail` (exception type names only, never request arguments, so a Wi-Fi password cannot leak). `Get-LiRadio` now returns `on/off/disabled/unknown`, `unsupported` only when Windows lists no such radio, and `error` with the reason; `Set-LiRadio` checks access, changes the state and returns only when Windows reports it (or throws). Codes with a fix (`location_denied`, `radio_denied`) carry an action; the UI shows the Windows message plus a button (`settings.open` is a whitelist of five `ms-settings:` pages, nothing else).
* **Tests (Linux):** `native-errors.test.js` runs the real `Start-LiLoop` under PowerShell with C# that throws typed, COM, plain, nested and failed-Task errors. **The Phase 2 logic was reproduced** (`code: failed`, `Exception calling "ThrowTyped"…`) **and the new logic returns `password`, `com (0x80070005)`, `location_denied`.** Plus `errors.test.js` (whitelist). *Ran on PowerShell 7 on Linux; the same test uses `powershell.exe` 5.1 on Windows and in CI.*
* **Windows verification:** not verified. Expected: typed error toasts with readable text; a Wi-Fi radio failure shows Windows' reason, not "No adapter".
* **Limitations:** WinRT radio behaviour on your PC (does `RequestAccessAsync` return `Allowed`?) is still unknown; the diagnostic prints it.

## 4. Item 2: Wi-Fi (F1, F4, F5, F6)

* **Problems and root causes:** see the audit. F1: Windows 11 24H2+ returns `ERROR_ACCESS_DENIED` for scan, network list and current-connection unless "Let desktop apps access your location" is on, and the code ignored the return codes, producing "No networks found" / "Connected to null". F4: connect used the SSID as the profile name. F5: profile created as all-user. F6: WEP and WPA-PSK misclassified.
* **Files:** `native/cs/Wlan.cs` (LiWlan rewritten), `native/net.ps1`, `src/system/{validate,index}.js`, `renderer/cc.js`.
* **Implementation**
  * Every `wlanapi` return code is checked and turned into a typed error; `Win32Exception` text is included.
  * Scan denied → the helper returns **saved profiles** from `WlanGetProfileList` (not location-gated) with `limited: true`; the UI says scanning is blocked and offers the Location settings button. Saved networks stay connectable.
  * Connected SSID unreadable → falls back to the documented `WlanConnectionProfileDetails.GetConnectedSsid`; if that also fails the UI says **"Connected"** (never "null") and explains why.
  * `Connect` now **blocks until Windows reports `connection_complete`** for *that* profile, checks the reason code (human text via `WlanReasonCodeToString`), then confirms the adapter state is *connected* before replying. On failure the profile it created is deleted, so a wrong password is not saved. Per-user profile first (`WLAN_PROFILE_USER`), all-user only as a retry.
  * Real profile names for saved networks; WEP, WPA, WPA2, WPA3, OWE, enterprise classified; WEP/enterprise honestly refused with an explanation.
  * Disconnect and radio changes **verify by reading back**. Radio: WinRT first (consent-based), WLAN `WlanSetInterface` as a fallback; both errors are reported if both fail.
  * Scan waits for Windows' `scan_complete` instead of a fixed 2.5 s sleep.
  * Events: WLAN callbacks (ACM + MSM radio-state-change). One producer builds the state, so the SSID fallback is never overwritten.
* **Tests (Linux):** `wifi.test.js` (validator rules, limited scan result with action, error propagation); UI scenario 07 (69/69) after updating the mock to the new blocking-connect contract. Mock helpers prove Node/UI logic only.
* **Windows verification:** not verified.
* **Limitations / risks**
  * Whether Windows 11 grants a per-user profile to a non-elevated process, and the exact WPA3 profile XML, are unconfirmed.
  * `MSM radio_state_change` firing for the Quick Settings toggle is my reading of the docs; `--watch` tests it.
  * In scan-denied mode a saved profile whose name differs from its SSID shows the profile name.
  * Connect blocks the Wi-Fi helper for up to ~28 s (other Wi-Fi requests queue). Bluetooth, audio and power are separate helpers and unaffected.

## 5. Item 3: Sound output (F7, F8)

* **Problem:** output switching "unreliable"; success toast before Windows confirmed.
* **Root cause:** F7: no post-switch confirmation. **F8: I could not find a defect in the `IPolicyConfig` declaration** (IID, 12-method order, `SetDefaultEndpoint` slot, `PROPVARIANT` size all match the widely used layout). The audit said the cause was undetermined and **it remains undetermined until your diagnostic runs.**
* **Files:** `native/cs/Audio.cs`, `native/audio.ps1`, `src/system/index.js`.
* **Implementation:** `SetDefaultOutput` validates the endpoint is active, sets all three roles checking **each HRESULT**, releases the COM objects, then **polls Windows until it reports the new default** (≤2.5 s) and returns the real state. Failures are typed (`not_found`, `com` with HRESULT, `unverified`). All other setters use `LiError.FromHr` (HRESULT visible). The backend then re-reads and compares again (item 4).
* **Tests (Linux):** `verify.test.js` (setOutput honest vs lying helper). C# compiled.
* **Windows verification:** not verified. **If switching still fails, the message will now contain the HRESULT and the failing role**, which is exactly the evidence needed.
* **Limitations:** if Windows' policy object refuses on your build, this batch reports it precisely but cannot fix it. A fallback design would be needed.

## 6. Item 4: Authoritative refresh (F14)

* **Problem:** the UI changed only when a native event arrived; a missed event left it stale; success was reported on the helper's say-so; `unavailable` was never cleared.
* **Implementation:** after every write the backend re-reads the real state from the helper and compares it to the request (volume ±1, brightness ±2, output id, mute, radio, power mode, Wi-Fi connected/disconnected, Bluetooth connected/pair). If Windows disagrees it fails with `unverified` and says **what Windows reports**. Newest-wins for sliders, so superseded drags are not reported as failures. A recovered helper clears its stale "unavailable" marker.
* **Files:** `src/system/index.js`, `renderer/cc.js`.
* **Tests (Linux):** `verify.test.js` (5 tests, including a helper that replies OK without changing anything, which becomes `unverified: Windows reports the volume as 30%`).
* **Windows verification:** not verified.
* **Limitations:** verification adds one helper read per operation (bounded polling, only after a user action, ≤4 s).

## 7. Item 5: Bluetooth (F10, F11)

* **F10 (connect no-op):** enabling already-enabled profiles may do nothing; now if not connected after 3.5 s the helper **disables, waits, re-enables** and waits up to 9 s. Per-profile Win32 codes are reported (`1060` = device has no such profile). `BluetoothGetDeviceInfo` fills the device record first.
* **F11 (LE):** discovery now covers classic **and** low-energy devices (unnamed advertisers and already-paired devices are not listed). LE devices can be paired; connect/disconnect for LE stays honestly *unsupported* (Windows gives apps no way to force it).
* **Also fixed:** the empty first device list and the never-working discovery (section 2); paired devices opened but failing are logged, not silently dropped; list order is stable (no spurious events); a **paired-device watcher** delivers pairings made in Windows Settings as events.
* **Files:** `native/bt.ps1`, `native/cs/Bluetooth.cs`, `native/cs/WinRtEvents.cs`, `src/system/index.js`, `renderer/cc.js`.
* **Tests (Linux):** none that exercise Windows (the bridge test is item 8). Compiled and parsed only.
* **Windows verification:** not verified.
* **Limitations:** unpaired-LE selectors and the disable/enable cycle are unproven on hardware; some devices will still refuse.

## 8. Item 6: Proton VPN (F13)

* **Problem:** "connected" whenever any interface mentioning "protonvpn" was Up, with no address check.
* **Implementation:** connected requires the tunnel adapter **Up with a usable (non link-local, non loopback) address**; adapters named kill-switch/callout/split/leak are excluded; "Connecting…" while up without an address; the evidence sentence is exposed (and printed by the diagnostic); the registry install lookup is cached for 60 s. It remains **observation only**: there is no documented Proton API, and no traffic probe is done (that would contact an outside service). The official-app fallback is unchanged.
* **Windows verification:** not verified; needs your Proton VPN while connected and disconnected. **Limitation:** adapter-level evidence cannot prove traffic flows through the tunnel.

## 9. Item 7: Windows CI

`.github/workflows/windows-native.yml` on `windows-latest`: (1) `tools/windows/compile-native.ps1` compiles every helper's C# in a fresh **Windows PowerShell 5.1** through the same `Import-LiSource → Add-Type` path; (2) the unit tests, where the error-transport and WinRT-bridge tests now run on `powershell.exe` 5.1; (3) `diagnose.js --ci` starts all four real helpers and reads their state (no hardware on the runner, so "no adapter/no device" is a warning, crashes and untyped failures are failures). **It has never run**: it activates when this branch is pushed. Until then "compiles on Windows" is unproven.

## 10. Files

Added: `native/cs/WinRtEvents.cs`, `src/system/errors.js`, `.github/workflows/windows-native.yml`, `tools/windows/{diagnose.js,probe-wlan.ps1,compile-native.ps1}`, `tools/tests/{wiring,errors,wifi,verify,native-errors,native-events}.test.js`, `tools/tests/fixtures/*`, docs (this and the audit).
Modified: `native/{net,bt,audio,power}.ps1`, `native/lib/{common,winrt}.ps1`, `native/cs/{LiIO,Wlan,Audio,Bluetooth}.cs`, `src/system/{index,helper,validate}.js`, `preload.js`, `renderer/{cc.js,cc.css}`, `tools/ui-harness/mock-native/net.js`, `tools/ui-harness/scenarios/07-control-centre.js`, `.gitignore`.
No settings keys, user data or plugin code were touched.

## 11. Testing on your Windows 11 PC

Open **Windows PowerShell or Terminal as a normal user (not administrator)**.

1. Get the branch (the branch is **not on GitHub**; it is in the bundle file):
   ```powershell
   cd C:\path\to\EyeLandForWindows          # your existing clone; use the real path
   git status                               # commit or stash your own changes first
   git fetch "$HOME\Downloads\liquid-island-phase3-batch2.bundle" feature/phase-3-dynamic-feedback-audio-studio:feature/phase-3-dynamic-feedback-audio-studio
   git switch feature/phase-3-dynamic-feedback-audio-studio
   git log --oneline -1                     # expect: Batch 2.8 report ...
   ```
   No clone? `git clone -b feature/phase-3-dynamic-feedback-audio-studio "$HOME\Downloads\liquid-island-phase3-batch2.bundle" EyeLandForWindows` then `cd EyeLandForWindows`.
2. Check you are in the repo root: `dir tools\windows` must list `diagnose.js`. Node 18+ is required (`node -v`).
3. **Read-only run first:** `node tools\windows\diagnose.js`
4. **Audio switch:** `node tools\windows\diagnose.js --audio-switch` (needs two active output devices; it restores the original).
5. **Automatic notifications, separately:** `node tools\windows\diagnose.js --watch 90`, then within 90 s change things **in Windows itself**: toggle Wi-Fi and Bluetooth in Quick Settings, connect/disconnect a Bluetooth device, switch sound output, change volume, plug/unplug the charger.
6. Optional manual-control tests (each changes real state and restores it): `--wifi-toggle`, `--bt-toggle`, `--bt-scan`, `--power-mode`, `--brightness`.
7. Each run writes `diagnostics\cc-diagnose-<time>.json` (contains SSIDs and device names; review before sharing). Please send me the read-only and audio-switch results, and the `--watch` result if you can.
8. To try the app: `npm install` then `npm start`, open the Control Centre.

**What to look for in the read-only report**

* `[wifi] WlanGetAvailableNetworkList return code`: `5` confirms F1 on your PC.
* `[bt] WinRT event subscriptions`: `PASS` means the reflection bridge works on real WinRT; `FAIL` lists the exact reason and the 5 s fallback is in use.
* `[audio] helper starts`: confirms the audio C# compiles on Windows.
* `[env] Location consent` and `Radios consent`: whether Windows denies this at the privacy-setting level.

## 12. Known limitations and open items

* **Not Windows verified: everything.** The highest-risk assumptions: real-WinRT acceptance of `AddEventHandler`; `MSM radio_state_change` on Quick Settings toggles; per-user Wi-Fi profiles for non-elevated apps; Bluetooth connect cycle; the cause of the output-switching failure (still undetermined).
* The CI workflow has never run.
* UI scenarios 05 and 09 fail identically on untouched `origin/main` in this environment (harness settings setup), so they are not evidence for or against this batch.
* The Electron UI scenarios use mock helpers. They validate renderer/backend logic, not Windows.
* Night Light, microphone logic and display detection are unchanged apart from the shared error handling.
* Not started (by your instruction): hover/collapse, motion system, Audio Studio, media, lyrics, charging sound, settings additions, README/completion report.


## 13. First Windows run (your PC, Windows 11 build 26300, PowerShell 5.1.26100)

These are **measured** results from the diagnostic you ran, and they changed the picture.

**What it proved**

| Result | Meaning |
|---|---|
| Audio helper starts | The audio C# compiles on real Windows. |
| `--audio-switch`: switched to *Speaker (Realtek)* in 170 ms, Windows re-read confirmed it, an `audio` event was pushed, original (FxSound) restored | **Native output switching works** with the Batch 2 code. The Phase 2 failure is therefore not in the `IPolicyConfig` call itself. It is still unexplained: candidates are the Phase 2 error handling, the app path, or FxSound (a virtual device that may re-assert itself as default). The new verification layer reports `unverified` plus what Windows says if that happens in the app. |
| Power helper starts; a battery-percentage change was pushed as an event (79 to 78) | The power event path works on Windows. Brightness (100) and power mode (balanced) read correctly. |
| Location consent `Allow`; `WlanScan` 0; network list 0 (23 networks); current-connection query 0 | **Finding F1 is not the cause of your Wi-Fi problem.** It remains a real latent bug for PCs where that setting is off, and the handling stays. |
| Windows PowerShell 5.1, FullLanguage, build 26300 | The assumed runtime is right. |

**What it exposed: two defects in this batch, now fixed**

1. **The `net` helper (Wi-Fi + VPN) did not start.** `Wlan.cs` kept an unused field `last` after I rewrote `Emit`; Windows' compiler promotes that warning to an error (`Warning as Error: The field 'LiWlan.last' is assigned but its value is never used`) and the helper crash-looped. **My mistake:** my Mono compile printed `1 warning(s)` and I had filtered warnings out of the output, so I reported "compiles". Fixes: field removed; `tools/tests/csharp-compile.test.js` now compiles every helper at C# 5 and **fails on any warning** (verified: it fails when the bug is reintroduced), with a justified allowlist for two Mono-only false positives in Phase 2's `Power.cs` that Windows compiles fine. The Windows CI job would have caught this and has still never run.
2. **WinRT event subscription by `EventInfo.AddEventHandler` is rejected by Windows.** Exact message: `Adding or removing event handlers dynamically is not supported on WinRT events.` So the Bluetooth helper fell back to polling, as designed (it did not crash; the failure was reported precisely). Fix: `LiWinRt` now uses the route the C# compiler itself emits, `WindowsRuntimeMarshal.AddEventHandler<T>` over the token-returning accessors, then a direct accessor call, and reports why *each* strategy failed. **Not yet verified on Windows.** `tools/windows/probe-winrt-events.ps1` prints the real accessor signatures, tries the subscription, tests a compile-against-`.winmd` plan B, and (with `-Seconds 20`) shows whether events actually arrive when you toggle Bluetooth.

**Still unknown after this run**

* Wi-Fi: nothing could be measured (helper was down). Re-run after pulling the fix.
* Bluetooth radio was **off** with no paired devices listed, so device/connect/discovery paths are untested.
* `--watch`: the only event seen in the window was power; no Wi-Fi/Bluetooth/audio change was made during it (or the helpers were not producing events). It proves nothing about those paths yet.
