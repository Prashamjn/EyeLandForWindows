# Liquid Island

A macOS Dynamic Island-inspired island for Windows. A small black capsule sits at the top of your screen and morphs
into a live dashboard when you hover it: what is happening right now on top, your clock, weather, quick actions and
twenty built-in tools underneath.

> Liquid Island is the new name and design of the project formerly called Eyeland.

## Run
1. Install Node.js 18 or newer
2. In this folder: `npm install`, then `npm start`
3. Installer: `npm run dist` (output in `dist/`, must be run on Windows). Turn on "Start with Windows" in Settings.

## The island
It has three states and moves smoothly between them (reduced-motion is respected).

- **Compact** (idle): a plain black capsule. A small cup or countdown appears only while Coffee mode or the focus timer is running.
- **Mini**: a short expansion for what just happened. Volume and brightness (icon, bar, percentage), charging or unplugging, plugin results such as "Copied 128 characters", and a new track starting.
- **Full** (hover to open): two clearly separated sections.
  - *Activity area* (top): shows the current activity with its controls. Media with previous/play/next, a running focus timer, or volume, brightness and notices as they happen. When nothing is going on it says so.
  - *Dashboard* (below): clock and date, weather for your location, quick actions (mute, Coffee mode, text extractor, colour picker), volume and brightness sliders, and navigation for Plugins (grouped by category, with their shortcuts), Timer, Clipboard, Tasks and Settings.

The island hides automatically while a full screen app (game, F11 browser, video, slideshow) is in front. Toggle in Settings.

Weather uses the same source as the Weather plugin (Open-Meteo, location from your IP address or the city you chose in the plugin). If the location or network is unavailable it says so and offers "Try again". It never shows made-up values.

## Plugins
Open any of them from the Plugins tab or its shortcut. Change shortcuts in the Shortcuts page (Settings tab, "Plugin shortcuts").

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
- Windows 11 gets a real acrylic glass window for the plugin hub. Windows 10 gets a solid dark window with the same layout. The island itself is deliberately solid black: a transparent, rounded, click-through Electron window cannot show real acrylic behind its shape.
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
`main.js` main process and wiring. `src/` plugin back ends. `renderer/` the island (`tokens.css` design tokens, `island.css` shell and motion, `dashboard.css` components; `core.js`, `activity.js`, `island.js`, `dashboard.js`, `panels.js`, `app.js`). `hub/` plugin window and pages. `overlay/` screen capture, color picker and drawing. `native/` PowerShell helpers (volume, brightness, fullscreen, media). `shared/` plugin list, icons and weather helpers. `tools/ui-harness/` development-only UI test harness. `docs/` project reports.

## Upgrading from Eyeland
Settings, tasks, calendar events, voice memos and downloads are kept: the app continues to use the existing `%APPDATA%\eyeland` data folder, and the `Eyeland` folders in Downloads are unchanged. The old eye colour setting is ignored.
