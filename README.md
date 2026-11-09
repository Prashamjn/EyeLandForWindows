# Liquid Island

A macOS Dynamic Island-inspired island for Windows. A small black capsule floats just below the top of your screen and morphs
into a live dashboard when you hover it. Everything happens inside it: the dashboard, all twenty built-in tools, and a Windows
Control Centre (Wi-Fi, Bluetooth, VPN status, sound, brightness, battery and more). It never opens a separate plugin window.

> Liquid Island is the new name and design of the project formerly called Eyeland.

## Run
1. Install Node.js 18 or newer
2. In this folder: `npm install`, then `npm start`
3. Installer: `npm run dist` (output in `dist/`, must be run on Windows). Turn on "Start with Windows" in Settings.

## The island
It has three states (plus two workspaces) and moves smoothly between them. Reduced motion is respected (the OS setting or Settings > Reduce motion).

- **Compact** (idle): a plain black capsule. A small cup or countdown appears only while Coffee mode or the focus timer is running.
- **Mini**: a short expansion for what just happened. Volume and brightness (icon, bar, percentage), plugin results such as "Copied 128 characters", a new track starting, and **device notifications** (see below).
- **Full** (hover to open): two clearly separated sections.
  - *Activity area* (top): shows the current activity with its controls. Media with previous/play/next, a running focus timer, or volume, brightness and notices as they happen. When nothing is going on it says so.
  - *Dashboard* (below): clock and date, weather for your location, quick actions (mute, Coffee mode, text extractor, colour picker), volume and brightness sliders, and navigation for Plugins (five categories, favourites, shortcuts), Control Centre, Timer, Clipboard, Tasks and Settings.
- **Plugin workspace**: choosing a plugin grows the capsule into a larger panel with the plugin's own page, a Back button, Home, Collapse, and star / pin buttons (star adds it to Favourites; pin puts it in the four Home quick actions). The island stays open while you use it, becomes keyboard-focusable only then, and collapses on Esc, Collapse, or after you click away for a few seconds (the page is kept, so reopening resumes it; choose "Start at Home" in Settings to change that).
- **Control Centre**: the same large panel, from the bottom navigation. See below.

The island hides automatically while a full screen app (game, F11 browser, video, slideshow) is in front. Toggle in Settings.

Weather uses the same source as the Weather plugin (Open-Meteo, location from your IP address or the city you chose in the plugin). If the location or network is unavailable it says so and offers "Try again". It never shows made-up values.

## Control Centre
Tiles for Wi-Fi, Bluetooth, VPN, Battery; sliders for volume and brightness; a sound output picker; tiles for microphone, power mode, Night Light, displays and charging. Click a tile for its detail page. Each tile shows what Windows reports, never a guess.

| Feature | What you can do | How |
|---|---|---|
| Volume, mute, sound output | Change volume, mute, **switch the default output device** | Windows Core Audio. Changes made with the keyboard keys show up immediately |
| Brightness | Slider | WMI (built-in displays). Hidden when the display cannot be controlled. External monitors are not supported |
| Wi-Fi | On/off, list nearby networks with signal, connect (password prompt for new secured networks), disconnect | Native Wifi API, `Windows.Devices.Radios`. Work/school (802.1X) networks must be joined from Windows settings |
| Bluetooth | On/off, paired devices with real connection state, connect / disconnect (classic devices), search and pair | `Windows.Devices.Bluetooth`, `BluetoothSetServiceState`. Low-energy devices (most mice and keyboards) reconnect by themselves; Windows does not let apps force that |
| VPN (Proton VPN) | Shows installed / running / **connected** | Read-only: the app's network adapter state. **Cannot connect or disconnect**: Proton publishes no control interface for Windows. A button opens the Proton VPN app |
| Battery, charging | Percentage, charging, AC, time left, battery saver | `GetSystemPowerStatus` plus Windows power events |
| Microphone | Default device, mute / unmute | Core Audio mute flag only. The app never listens to or records audio |
| Power mode | Best power efficiency / Balanced / Best performance | `PowerSetUserConfigured{AC,DC}PowerMode` (Windows 11). A mode Windows refuses is reported, not shown as active |
| Night Light | **Status not available.** Opens Windows Settings | Windows has no supported API for it, and this app does not use registry hacks |
| Displays | Name, resolution, refresh rate, scaling, count | Read-only |

## Device notifications
When something really changes, the capsule expands for about three seconds and shows an icon, a title and the device or network name: *Sony WH-1000XM5 connected*, *Connected to Home Wi-Fi*, *Proton VPN connected*, *Switched to Speakers*, *Microphone muted*, *Power mode: Balanced*, *Charger connected*, *Battery low*, display added or removed. Nothing is shown for the first reading after start-up or for an unchanged state, and each category can be switched off in Settings. Notifications never take keyboard focus. Detection is event-driven (Windows notifications) rather than polling.

## Plugins
Open any of them from the Plugins tab or its shortcut; they open inside the island. Change shortcuts in the Shortcuts page (Settings tab, "Plugin shortcuts").

| Plugin | Default | What it does |
|---|---|---|
| Text extractor | Ctrl+Alt+T | Drag over any text on screen, it is copied to the clipboard (OCR, works on images and video) |
| Lens search | Ctrl+Alt+L | Select part of the screen, search for it with Google Lens, Bing or Yandex |
| Color picker | Ctrl+Alt+C | Magnifier plus click to copy a pixel color as HEX, RGB or HSL |
| Draw on screen | Ctrl+Alt+D | Pen sizes, colors, marker, eraser, undo. Esc clears everything and closes |
| Translate | Ctrl+Alt+R | Scan text on screen or type it, read the translation |
| Tasks | Ctrl+Alt+N | To-do list (also in the island) |
| Calendar | Ctrl+Alt+E | Month view with events |
| Calculator | Ctrl+Alt+U | Expression calculator and unit converter |
| Weather | Ctrl+Alt+W | Current weather and 5 day forecast for your area |
| Voice memos | Ctrl+Alt+M | Record, play, rename, export MP3, WAV or M4A |
| QR code | Ctrl+Alt+Q | Live preview, 5 dot styles, 4 corner styles, colors, logo and label, copy or save PNG |
| Coffee mode | Ctrl+Alt+K | Keeps the screen awake, optional timer |
| File converter | Ctrl+Alt+F | Image to image or PDF, audio to audio, video to video, GIF or audio, text/Markdown/HTML to PDF, PDF to images |
| File size reducer | Ctrl+Alt+Z | Images, video, audio, PDF and any other file (zip) |
| Print | Ctrl+Alt+P | Preview, printer, paper, orientation, margins, color, sides, copies, page range, Save as PDF |
| Temp cleaner | Ctrl+Alt+X | Temp folders, caches, crash dumps, Recycle Bin |
| YouTube downloader | Ctrl+Alt+Y | Fetch info, trim a segment, MP3 or MP4 in best quality, live progress |
| Speed test | Ctrl+Alt+S | Ping, jitter, download, upload |
| QuickShare | Ctrl+Alt+H | Send files to a phone or receive from it over Wi-Fi with a QR code |
| System monitor | Ctrl+Alt+I | CPU per core, memory, disks, device details |

## Notes and limits
- The island is deliberately solid black: a transparent, rounded, click-through Electron window cannot show real acrylic behind its shape.
- The Control Centre and device notifications use PowerShell helpers that only run on Windows. On other systems the app starts, but those tiles say they are unavailable. Windows PowerShell 5.1 (built into Windows 10/11) is required. Wi-Fi and Bluetooth switches need *Settings > Privacy & security > Radios* to allow apps.
- Choosing the default sound output uses the `IPolicyConfig` COM interface, which Microsoft does not document (there is no public API for it). It is what Windows' own Sound settings and tools such as SoundSwitch use.
- Text extractor downloads each OCR language once (10 to 20 MB). Pick languages on the Text extractor or Translate page.
- Lens search needs a web address for the image, so the selected area is uploaded to catbox.moe for 1 hour. You are asked once before the first upload.
- Translation uses Google's public translate endpoint with MyMemory as a fallback. Both are online and unofficial, so they can change.
- YouTube downloader fetches yt-dlp from its GitHub releases on first use. If YouTube changes something, use "update the engine". Recent yt-dlp versions may ask for a JavaScript runtime: `winget install DenoLand.Deno`. Only download what you have the right to save.
- PDF size reduction uses Ghostscript when installed. Without it, pages are re-rendered as pictures (smaller, but the text is no longer selectable).
- Brightness works on laptop and built-in displays (WMI). External monitors are not supported, and the brightness controls are hidden when the display does not support it.
- QuickShare listens only on your local network, requires a random link, and stops when you press Stop. Allow Liquid Island on private networks when Windows asks. 5 GHz Wi-Fi is fastest.
- Printing Office files (Word, Excel, PowerPoint) hands them to Windows, so there is no preview for those.
- Exclusive full screen games can hide any window, including screen overlays. Borderless mode works.
- On keyboards with AltGr, Ctrl+Alt shortcuts can type characters. Rebind them in the Shortcuts page.

## Folder map
`main.js` main process and wiring (window placement, IPC, plugin back ends, shortcuts). `preload.js` the only bridge into the page (channel allowlist, narrow `cc` API). `src/` plugin back ends; `src/system/` Control Centre back end (`helper.js` native process manager, `validate.js` argument checks, `notify.js` notification rules, `display.js`, `index.js`). `renderer/` the island: `tokens.css`, `island.css` (shell and motion), `dashboard.css`, `workspace.css`, `plugins.css` (scoped to plugin pages), `cc.css`; `core.js`, `activity.js`, `island.js` (state machine), `dashboard.js`, `panels.js`, `workspace.js` (embedded plugin container and navigation), `cc.js`, `notify.js`, `app.js`; `renderer/plugin-host.js` and `renderer/plugins/` the 21 plugin pages. `overlay/` screen capture, colour picker and drawing. `native/` PowerShell helpers: `audio.ps1`, `net.ps1`, `bt.ps1`, `power.ps1` (JSON-lines protocol, C# in `native/cs/`), `sys.ps1` (full-screen detection, media keys), `media.ps1`. `tools/ui-harness` and `tools/tests` development tests (not packaged).

## Tests
`npm run test:unit` runs the Node unit tests. `tools/ui-harness/README.md` explains the Electron UI scenarios (simulated native helpers on Linux; real behaviour needs Windows). See `docs/PHASE_2_COMPLETION_REPORT.md` for what has and has not been verified.

## Upgrading from Eyeland
Settings, tasks, calendar events, voice memos and downloads are kept: the app continues to use the existing `%APPDATA%\eyeland` data folder, and the `Eyeland` folders in Downloads are unchanged. The old eye colour setting is ignored.
