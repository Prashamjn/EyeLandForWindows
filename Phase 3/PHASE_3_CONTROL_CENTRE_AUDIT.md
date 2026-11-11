# Phase 3, Batch 1: Control Centre end-to-end audit

Branch: `feature/phase-3-dynamic-feedback-audio-studio` · Status: **investigation only, no production code changed**

## 0. Read this first: what this audit can and cannot claim

This audit was done in a Linux sandbox. It has **no Windows, no PowerShell, and no C# compiler** (`pwsh`, `mcs`, `csc`, `dotnet` are all absent).
That has three consequences, stated plainly so nothing below is mistaken for more than it is:

1. Every finding is established by **reading the source and Microsoft's documentation**, not by running it on Windows.
2. No native feature is marked "Windows verified". Nothing in this batch is.
3. I could not even confirm that the C# in `native/cs/` **compiles**. Phase 2 could not either.

Each finding carries an evidence grade:

| Grade | Meaning |
|---|---|
| **DOC+CODE** | Microsoft documentation states the behaviour, and the code is shown to violate it. |
| **CODE** | Provable from the source alone (logic or language semantics), regardless of Windows version. |
| **PROBABLE** | Plausible from documentation or experience, but the actual outcome depends on the machine. Needs the diagnostic run. |
| **UNDETERMINED** | No defect found by static analysis. Cause (if any) is unknown. |

`tools/windows/diagnose.js` (added in this batch) turns every PROBABLE and UNDETERMINED item into a measured result. Section 6 says how to run it.

## 1. Phase 2 baseline verification

* Your note said Phase 2 was not pushed. It **is** on GitHub now: `origin/feature/phase-2-embedded-plugins-control-center` @ `1fb98b4`, and merged into `main` by PR #3 (`7ca6501`).
* The three Phase 2 implementation commits are present on top of `db695b2`: `1c41cc1` (native helpers + backend), `9d24f8a` (workspace, Control Centre UI, notifications), `6543789` (tests, simulated helpers, docs). Then `91d3d96` (Windows 11 test plan) and `1fb98b4`.
* `main` is Phase 2 plus two commits (`7a949bf`, `f4584d3`) that only move Phase 1 report files. **No Phase 2 code is missing**, so no bundle is needed.
* Phase 3 branches from `origin/main` (`7ca6501`). Working tree was clean. Nothing pushed, nothing force-moved.
* Existing unit tests: 19/19 pass. With this batch's wiring test: 23/23.

## 2. The communication path, layer by layer

`Renderer (renderer/cc.js) → Preload (window.cc.call) → IPC 'cc:call' (main.js:179) → src/system/index.js call() → validate.js → Helper.request() → powershell.exe -File native/*.ps1 → C# via Add-Type (native/cs/*.cs) → Windows API → JSON reply → cc:event → renderer`

### 2.1 Wiring layers: verified correct (CODE, mechanically checked)

All **20 operations** are consistent across: the preload allow-list, the validators, the `run()` switch, the helper command name sent, and the `.ps1` handler that receives it. IPC channel names agree in preload, main and backend. There are no missing handlers, wrong channel names, or wrong command names. This is now enforced by `tools/tests/wiring.test.js`.

Consequence: **the bugs are not in the Renderer, Preload, or IPC layers.** They are in native behaviour and in how errors travel back up.

### 2.2 Per-operation verdict

| Operation | Wiring | Native call | Verdict |
|---|---|---|---|
| Volume / mute | OK | Core Audio `IAudioEndpointVolume` | No defect found. Declarations match the SDK by hand-comparison. Probably works. Not verified. |
| **Sound output switch** | OK | `IPolicyConfig.SetDefaultEndpoint` x3 roles | **UNDETERMINED** (F8). No post-switch confirmation (F7). Errors arrive garbled (F2). |
| Microphone mute | OK | `IAudioEndpointVolume.SetMute` (capture) | No code defect. Some drivers refuse endpoint mute; the error would arrive garbled (F2). |
| **Wi-Fi on/off** | OK | WinRT `Radio.SetStateAsync` | **PROBABLE** problems: errors masked as "unsupported" (F3). Not determined. |
| **Wi-Fi scan** | OK | `WlanScan`, `WlanGetAvailableNetworkList` | **Fails silently on current Windows 11** (F1). |
| **Wi-Fi connect** | OK | `WlanSetProfile` + `WlanConnect` | Wrong profile name (F4), possible access-denied (F5), garbled errors (F2). |
| Wi-Fi disconnect | OK | `WlanDisconnect` | Return code ignored (F9). |
| Connected network name | n/a | `WlanQueryInterface(7)` | **Fails silently on current Windows 11** (F1): UI can show "Connected to null". |
| Bluetooth on/off | OK | WinRT `Radio.SetStateAsync` | Same as Wi-Fi radio (F3). |
| Bluetooth paired list | OK | WinRT `DeviceInformation` | Errors swallowed (F9). |
| Bluetooth discovery | OK | `DeviceWatcher` (classic only) | LE never found, UI does not say so (F11). |
| Bluetooth connect/disconnect | OK | `BluetoothSetServiceState` | PROBABLE no-op on already-enabled profiles (F10). Honest error path exists. |
| Brightness | OK | WMI `WmiMonitorBrightnessMethods` | Failure indistinguishable from "unsupported monitor" (F9). |
| Power mode | OK | `powrprof` `*UserConfigured*PowerMode` | No defect found. "Better battery" shows as "Custom" (F12). |
| Battery / charging | OK | `GetSystemPowerStatus` | No defect found. |
| Displays | OK | Electron `screen` (read-only) | No defect found. |
| Night Light | OK | opens `ms-settings:nightlight` | Honest fallback preserved. |
| **Proton VPN status** | OK | adapter-name match | Can over-report "connected" (F13). |

## 3. Findings

### F1. Wi-Fi scanning and SSID reading are blocked without location consent, and the code hides the error · **DOC+CODE** · highest impact

* **Documentation** (Microsoft Learn, *Changes to API behavior for Wi-Fi access and location*): on Windows 11 24H2 and later, `WlanScan`, `WlanGetAvailableNetworkList` and `WlanQueryInterface` with `wlan_intf_opcode_current_connection` return `ERROR_ACCESS_DENIED` unless the user has allowed it under *Settings → Privacy & security → Location → "Let desktop apps access your location"*. The same page recommends `WlanConnectionProfileDetails.GetConnectedSsid` for reading the SSID.
* **Code**: all three return codes are ignored.
  * `native/cs/Wlan.cs:113` ignores the `WlanScan` result.
  * `Wlan.cs:114`: `if (WlanGetAvailableNetworkList(...) != 0) return "[]";` turns **access denied into an empty list**.
  * `Wlan.cs:93`: a failed `WlanQueryInterface` leaves `ssid = null` while `state` stays `"connected"`.
* **User-visible effect** when the setting is off: the Wi-Fi pane says "No networks found" (`cc.js:182`), the tile shows `null` as the network name (`cc.js:80`), and there is nothing to click, so you cannot connect to anything. It looks exactly like "Wi-Fi does not work" while notifications (which come from separate WLAN events) keep arriving.
* **What I cannot know:** whether this setting is off on your PC. The diagnostic reads it and prints the raw return codes.
* **Fix (Batch 2):** check every return code; return a typed `location_denied` error; show a plain explanation with an "Open location settings" button (`ms-settings:privacy-location`); read the SSID via the documented WinRT API; list **saved** networks with `WlanGetProfileList` (not gated) so connecting to known networks still works when scanning is denied.

### F2. Errors thrown from C# lose their code and gain a confusing prefix · **CODE** (PowerShell semantics)

* `native/lib/common.ps1:41` decides the error code with `$_.Exception -is [LiError]`. PowerShell wraps any exception thrown inside a .NET method call in `MethodInvocationException`, so this test is false for every `LiError` thrown by C# (`Wlan.cs`, `Power.cs`, `Audio.cs`).
* Effect: `password`, `unsupported`, `no_adapter`, `profile`, `unavailable` all arrive as `failed`, and messages become `Exception calling "Connect" with "4" argument(s): "…"`. This also affects HRESULT failures from `Marshal.ThrowExceptionForHR` in audio output switching, so a real COM error would reach you as an unreadable toast.
* Errors thrown by PowerShell's own `Throw-LiError` are not wrapped, which is why this looked fine in review.
* **Fix:** unwrap `InnerException` before the type test.

### F3. Radio control failures are reported as "this PC has no radio" · **CODE**

* `native/lib/winrt.ps1:21`: `catch { return @{ state = 'unsupported'; radio = $null } }` converts **any** exception (timeout, WinRT load failure, access problem) into "unsupported".
* The UI then dims and **disables** the Wi-Fi/Bluetooth switches (`cc.js:78-79`) and shows "No adapter"/"Not available", so a transient WinRT error looks permanent.
* `net.ps1:12` and `bt.ps1:59` call it at start-up with the same masking.
* Whether `Radio.RequestAccessAsync` / `SetStateAsync` are actually refused on your machine is **PROBABLE-but-unknown**; the diagnostic will show it. The fix is to preserve and surface the real status (`DeniedByUser`, `DeniedBySystem`, exception text).

### F4. Connecting to a saved network uses the wrong profile name · **CODE**

* `Wlan.cs:155`: `cp.profile = ssid;`. A saved profile's name is not required to equal its SSID (e.g. `Home WiFi 2`). The list result already contains the real name (`AvailNet.profile`, 256 wide chars) but `Networks()` never returns it.
* Effect for such networks: `WlanConnect` fails with `ERROR_NOT_FOUND` (1168), shown as "Could not start the connection (code 1168)".
* **Fix:** return the profile name from the scan and use it.

### F5. New-network profile is created as all-user, which may be refused · **PROBABLE**

* `Wlan.cs:152`: `WlanSetProfile(..., flags 0 ...)` creates an **all-user** profile.
* **Documentation:** this call returns `ERROR_ACCESS_DENIED` if the caller's token lacks `WLAN_WRITE_ACCESS` on the "add new all-user profiles" object. The documentation does not state the default for a non-elevated user, so I cannot tell you it fails on your PC. In my experience adding all-user profiles from an un-elevated process is denied, which would show as "Windows rejected the network settings (code 5)".
* **Fix:** create a per-user profile (`WLAN_PROFILE_USER`, 0x2) and fall back only if needed.

### F6. Wi-Fi security classification is too coarse · **CODE** (minor)

`Wlan.cs:123` labels anything that is not open/WPA-PSK/WPA2-PSK/WPA3-SAE/OWE as `enterprise`, so WEP and shared-key networks are wrongly blocked as "needs a work account". The WPA3 profile XML (`Wlan.cs:138`) is also untested on real hardware.

### F7. Output switching does not confirm the real default device · **CODE**

* `audio.setOutput` returns the helper's `true` and `cc.js:275` shows "Switched to X" immediately. The new default is only learned if a COM notification later arrives.
* You asked for the actual default to be confirmed after switching. It is not. **Fix:** have the helper re-read Windows after `SetDefaultEndpoint` and return the real state, failing if it does not match.

### F8. `IPolicyConfig`: declarations reviewed, no defect found, failure cause UNDETERMINED · **UNDETERMINED**

What I checked in `native/cs/Audio.cs:69-87`:

* IID `F8679F50-850A-41CF-9C72-430F290290C8` and coclass `870AF99C-171D-4F9E-AF0D-E63DF40C2BC9` are the ones SoundSwitch/AudioDeviceCmdlets use.
* The 12 methods are in the same order as the widely used layout. `SetDefaultEndpoint` sits in the right vtable slot (13). Role values 0/1/2 are correct.
* `PreserveSig` plus `Marshal.ThrowExceptionForHR` handles HRESULTs properly. The related `IMMDeviceEnumerator`, `IAudioEndpointVolume` and `PROPVARIANT` (24 bytes on x64) layouts also match.

I therefore **cannot attribute your output-switching failure to `IPolicyConfig`**, and I will not guess. The measurable candidates, which the diagnostic separates, are: the audio helper failing to compile or start on your PC; the HRESULT being hidden by F2; and a Windows 11 build-specific refusal. I could not check that the file compiles.

### F9. Failures are swallowed in many places, so errors look like "nothing there" · **CODE**

`Wlan.cs:114` and `:160` (disconnect ignores its result); `bt.ps1:31,37` (a paired-device query error yields an empty list, shown as "No paired devices"); `power.ps1:5` (a WMI failure returns null, so the brightness row is simply hidden at `cc.js:110`, indistinguishable from "unsupported monitor"); `Audio.cs` `Rebind` swallows exceptions.

### F10. Bluetooth connect may do nothing for already-enabled profiles · **PROBABLE**

`Bluetooth.cs` only **enables** services. If a paired device's profiles are already enabled, Windows may treat this as a no-op, and the helper then times out with "Windows did not confirm a connection". There is no false success (the code verifies status), but the action may fail often. The usual remedy is a disable-then-enable cycle. Unverified: needs a real headset.

### F11. Bluetooth discovery covers classic devices only and does not say so · **CODE**

`bt.ps1:82` watches `BluetoothDevice` selectors only. LE devices are never discovered, but the UI says "Looking for devices" (`cc.js:230`).

### F12. Power mode: "Better battery" shows as "Custom" · **CODE** (minor)

`Power.cs:37` knows 3 overlay GUIDs; the Windows 11 on-battery "Better battery" overlay maps to `other`.

### F13. Proton VPN can be over-reported as connected · **PROBABLE**

`Wlan.cs:173,215-217`: `connected = installed && any adapter whose name contains "protonvpn" is Up`. If the Proton client keeps any such adapter up while not connected (kill switch, split tunnelling), this reports a connection that does not exist. There is no IP or route check. Needs verification against the real client. Your rule, never report a connection that is not verified, is not strictly met today.

### F14. State only changes when an event arrives · **CODE**

After a write, the UI waits for a native event (`index.js` returns the helper's `true`). A missed COM or WMI event leaves the UI stale. `st.unavailable` is also never cleared once a helper recovers (`cc.js:28,35`). **Fix:** have the backend re-read and publish authoritative state after each operation.

### F15. Why Phase 2 tests did not catch any of this · **CODE**

`tools/ui-harness/mock-native/*.js` replace PowerShell and C# with Node. The mock `net` helper returns clean `{ssid, security, known}` data, always succeeds on `connect`, and never emits `ERROR_ACCESS_DENIED`, wrapped exceptions, or masked errors. No test spawns `powershell.exe`. So "19/19 passing" proves Node plumbing only. When I ran the new diagnostic harness against those mocks, it reported **23/23 PASS**, which is exactly why that result must not be read as Windows evidence.

### F16. Cold-start risk · **PROBABLE**

Each helper compiles its C# with `Add-Type` on every launch. `bt` `get` enumerates paired devices one at a time against a 20 s timeout (`index.js:83-86`, `helper.js:66`). With many paired devices on a slow machine, the first open could time out and show "Unavailable". Unmeasured.

## 4. Requirement check against "real functionality only"

| Rule | Today |
|---|---|
| No UI-only state | Met for state, **not met** for confirmation after write (F7, F14). |
| No false success | Output switch toasts before confirmation (F7). VPN may over-report (F13). |
| No silent failure | **Not met** (F1, F3, F9). |
| Honest unsupported messaging | Partly. Masking turns real errors into "unsupported" (F3). |

## 5. Proposed Batch 2 (needs your go-ahead)

In priority order, each verified on Windows before being called done:

1. **Error transport** (F2, F3, F9): unwrap C# exceptions, never mask real errors, typed codes end to end. Smallest change, unblocks every other diagnosis.
2. **Wi-Fi** (F1, F4, F5, F6): location-denied handling, SSID via supported API, saved networks via profile list, correct profile name, per-user profile, return-code checks, verified connected state.
3. **Sound output** (F7, F8): read-back confirmation, then whatever the diagnostic shows.
4. **Authoritative refresh** (F14): post-operation re-read; clear stale `unavailable`.
5. **Bluetooth** (F10, F11) and **Proton VPN** (F13): only after measuring on real devices.
6. A **real Windows CI job** (GitHub `windows-latest`) that compiles every `native/cs/*.cs` through the real `Add-Type` path. That alone answers "does it compile".

I will **not** start the Audio Studio until you have reviewed this.

## 6. How to run the diagnostic on Windows 11

Requires Node 18+ (already needed for the project). From the repository root, in a normal (non-elevated) terminal, because that is how the app runs:

```
node tools/windows/diagnose.js                  # safe, read-only
node tools/windows/diagnose.js --audio-switch   # switches default output to another device, verifies, restores
node tools/windows/diagnose.js --wifi-toggle    # Wi-Fi off then on (brief disconnect)
node tools/windows/diagnose.js --all            # every optional test
```

It writes `diagnostics/cc-diagnose-<time>.json` (git-ignored; contains SSIDs and device names, so review before sharing). Each check ends in PASS / FAIL / WARN / SKIP / INFO, and write tests **re-read Windows state afterwards**.

Expected results if my findings are right:

* **F1:** `WlanGetAvailableNetworkList return code` shows `5` (and `0 networks`) when location is off; the Location consent line reads `Deny`.
* **F2:** visible only after Batch 2 (compare error text before and after).
* **F8:** `--audio-switch` shows whether Windows actually changed default device, whether the audio helper even starts, and the real error if it did not.

Not yet written (Batch 2): Bluetooth connect against a named device, and Wi-Fi connect. Both change real state and need your explicit choice of device or network.

## 7. Files added in this batch

* `docs/PHASE_3_CONTROL_CENTRE_AUDIT.md`: this document
* `tools/windows/diagnose.js`: Windows diagnostic harness (drives the production helpers; self-tested only against mocks)
* `tools/windows/probe-wlan.ps1`: read-only Native Wifi return-code probe (**not executed**, no PowerShell here)
* `tools/tests/wiring.test.js`: wiring regression test (runs anywhere)
* `.gitignore`: ignores `diagnostics/`

No production file was modified.
