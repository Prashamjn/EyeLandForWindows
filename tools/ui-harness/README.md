# UI harness

Boots the real `main.js` in Electron with an isolated settings folder, drives the island through its real IPC
channels, takes screenshots and prints `[TEST] PASS/FAIL` lines. It is a development tool and is not packaged
(`package.json > build.files` does not include `tools/`).

```bash
# Linux / CI (needs xvfb). PowerShell watchers cannot start there, so volume, brightness and media are simulated
# by sending the same IPC events the watchers would send.
LI_SCRIPT=$PWD/tools/ui-harness/scenarios/03-behaviour.js LI_OUT=/tmp/shots \
  xvfb-run -a -s "-screen 0 1280x800x24" npx electron --no-sandbox --disable-gpu tools/ui-harness/run.js

python3 tools/ui-harness/composite.py /tmp/shots/*.png   # adds *_c.png over a grey backdrop to show transparency
```

Environment variables: `LI_SCRIPT` (scenario file), `LI_OUT` (screenshot folder), `LI_ROOT` (defaults to the repo),
`LI_SETTINGS` (JSON written to settings.json before boot), `LI_UD` (reuse a settings folder).

Scenarios 02 and 06 replace the `ey:ip-location` / `ey:fetch-json` IPC handlers with **test fixtures** to exercise
weather success and error states without internet. That is test-only; the app never ships fixture data.

## Phase 2 additions
`LI_NATIVE_MOCK=<dir>` runs the helpers in `mock-native/` (Node, same JSON-lines protocol) instead of PowerShell, and
`LI_MOCK_CTL=<dir>` lets a scenario inject "changes made outside the app" by appending `{ev,data}` lines to `<dir>/<helper>.ctl`.
**These are simulations.** They exercise the real renderer, preload, IPC, validation, helper manager, state cache and
notification logic, and prove nothing about real Windows Core Audio / WLAN / Bluetooth / power behaviour.

```bash
export LI_NATIVE_MOCK=$PWD/tools/ui-harness/mock-native
mkdir -p /tmp/ctl && for n in audio net bt power; do : > /tmp/ctl/$n.ctl; done; export LI_MOCK_CTL=/tmp/ctl
run() { LI_SCRIPT=$PWD/tools/ui-harness/scenarios/$1.js LI_OUT=/tmp/shots xvfb-run -a -s "-screen 0 1920x1080x24" npx electron --no-sandbox --disable-gpu tools/ui-harness/run.js; }
run 04-plugins-embedded            # every plugin opens inside the island, back/home/esc, favourites, pins, settings bus
run 07-control-centre              # tiles, sliders, Wi-Fi/Bluetooth/VPN/power flows, notifications, validation, security
run 08-geometry-and-interaction    # top gap, pill silhouette, simulated multi-display, pinning, focus, hit-test, motion
run 03-behaviour                   # Phase 1 behaviour (hover, animation sampling, coffee, clipboard, volume simulation)
# 05 needs LI_SETTINGS (see its header). 09 needs LI_SETTINGS + LI_EXPECT, e.g. migration of an old file:
LI_SETTINGS='{"offsetY":6,"theme":"graphite"}' LI_EXPECT='{"offsetY":10,"migrated":true,"keep":{"theme":"graphite"}}' run 09-settings-migration
```
Unit tests (no Electron): `npm run test:unit`.
