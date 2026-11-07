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
