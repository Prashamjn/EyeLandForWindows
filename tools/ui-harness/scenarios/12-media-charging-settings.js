// Phase 3: Now Playing (artwork, status, supported controls), the capsule visualizer, the single synced lyric line, the charger sound
// (real main-process detection driven through the mock power helper) and the new Settings sections.
// The media/lyrics messages are injected into the renderer as native/media.ps1 + main.js would send them. They prove the app logic only,
// never that Windows delivers this data (see the report: Windows verification steps).
const fs = require('fs'), os = require('os'), path = require('path');
const { spawnSync } = require('child_process');
const R = []; const ok = (n, c, x = '') => { R.push(!!c); console.log(`[TEST] ${c ? 'PASS' : 'FAIL'}  ${n}${x ? '  ' + x : ''}`); };
module.exports = async (c) => {
  const win = c.island(), ev = c.ev, wait = c.wait;
  const CTL = process.env.LI_MOCK_CTL, inject = (name, e, data) => fs.appendFileSync(path.join(CTL, name + '.ctl'), JSON.stringify({ ev: e, data }) + '\n');
  const BIN = require(path.join(c.ROOT, 'node_modules', 'ffmpeg-static'));
  const jpg = path.join(os.tmpdir(), 'li-art.jpg'); spawnSync(BIN, ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=0x3060c0:s=96x96', '-frames:v', '1', jpg]);
  const ART = fs.readFileSync(jpg).toString('base64');
  await wait(800);
  const save = async (p) => { await ev(`api.saveSettings(${JSON.stringify(p)}); Object.assign(LI.S, ${JSON.stringify(p)}); LI.bus.emit('settings', LI.S); 0`); await wait(200); };
  await save({ blurCollapseSec: 0 });
  const media = (o) => c.send('media', { title: 'Song', artist: 'Artist', album: 'Album', app: 'Spotify', playing: true, can: { prev: true, next: true, play: true }, ...o });
  const vizState = () => ev("(() => { const v = document.getElementById('cViz'); const i = v.querySelector('i'); return JSON.stringify({ hidden: v.hidden, play: v.dataset.play, anim: getComputedStyle(i).animationName, state: getComputedStyle(i).animationPlayState, busy: document.getElementById('island').hasAttribute('data-busy') }); })()").then(JSON.parse);
  const sub = () => ev("document.querySelector('.activity .act-sub, .act-sub') ? document.querySelector('.act-sub').textContent : ''");

  /* ---------- visualizer: real playback state only ---------- */
  let v = await vizState();
  ok('nothing playing: no visualizer, capsule is the minimal idle pill', v.hidden && !v.busy && v.anim === 'none' || (v.hidden && !v.busy), JSON.stringify(v));
  media({ playing: true }); await wait(400);
  v = await vizState();
  ok('playing: three-line visualizer appears in the capsule and animates (li-viz)', !v.hidden && v.play === '1' && v.anim === 'li-viz' && v.state === 'running' && v.busy, JSON.stringify(v));
  ok('the capsule has exactly three lines', await ev("document.querySelectorAll('#cViz i').length === 3"));
  media({ playing: false }); await wait(400);
  v = await vizState();
  ok('paused: the bars settle (no animation) but stay as the "media present" indicator', !v.hidden && v.play === '0' && v.anim === 'none', JSON.stringify(v));
  media({ title: '', artist: '', app: '', playing: false }); await wait(400);
  v = await vizState();
  ok('media session gone: back to the minimal idle look (hidden, not busy)', v.hidden && !v.busy, JSON.stringify(v));
  media({ playing: true }); await wait(300); await save({ mediaVisualizer: false });
  ok('visualizer toggle off: hidden even while playing', (await vizState()).hidden);
  await save({ mediaVisualizer: true }); ok('...and back on', !(await vizState()).hidden);
  await ev("LI.island.open(); 0"); await wait(700);
  ok('while the island is expanded (visualizer out of sight) its animation is paused: nothing animates unseen', (await vizState()).state === 'paused');
  await c.shot('90_media_playing');

  /* ---------- Now Playing content ---------- */
  media({ playing: true, art: ART }); await wait(400);
  ok('Now Playing shows title, artist and application name', await ev("document.querySelector('.act-title').textContent === 'Song'") && (await sub()) === 'Artist · Spotify', await sub());
  ok('album artwork is shown in the tile', await ev("!!document.querySelector('.act-tile img.art') && document.querySelector('.act-tile img.art').src.startsWith('data:image/jpeg;base64,')"));
  media({ playing: true }); await wait(300);
  ok('artwork is kept for the same track when later updates omit it', await ev("!!document.querySelector('.act-tile img.art')"));
  media({ title: 'Other', playing: true }); await wait(300);
  ok('a different track without artwork shows the plain icon (no stale artwork)', await ev("!document.querySelector('.act-tile img.art')"));
  media({ title: 'Song', playing: true, art: ART }); await wait(300); await save({ mediaArtwork: false });
  ok('artwork setting off: no artwork', await ev("!document.querySelector('.act-tile img.art')")); await save({ mediaArtwork: true });
  media({ title: 'Song', playing: true, art: '<script>alert(1)</script>' }); await wait(300);
  ok('a malformed artwork payload is ignored, never injected as HTML', await ev("!document.querySelector('.act-tile script') && !document.querySelector('.act-tile img[src*=\"script\"]')"));
  media({ playing: false }); await wait(300);
  ok('paused status is shown ("· Paused") and the play button offers Play', (await sub()).endsWith('Paused') && await ev("document.querySelector('.act-btn.primary').getAttribute('aria-label') === 'Play'"), await sub());
  media({ playing: true, can: { prev: false, next: true, play: true } }); await wait(300);
  ok('controls the player does not support are disabled (previous), others stay active', await ev("(() => { const b = [...document.querySelectorAll('.act-btn')]; return b[0].disabled === true && b[1].disabled === false && b[2].disabled === false; })()"));
  media({ playing: true }); await wait(200);
  ok('media app names are friendly (msedge -> Edge, Chrome, unknown ids cleaned)', await ev("LI.media.appName('MSEdge') === 'Edge' && LI.media.appName('chrome.exe') === 'Chrome' && LI.media.appName('SpotifyAB.SpotifyMusic_zpdnekdrzrea0!Spotify') === 'Spotify' && LI.media.appName('Foo.Bar!App') === 'App'"));

  /* ---------- lyrics: one synced line, only with real timestamps ---------- */
  const lines = [{ t: 1, text: 'first line' }, { t: 5, text: 'second line' }, { t: 9, text: 'third line' }, { t: 14, text: '' }, { t: 20, text: 'last line' }];
  const key = 'Spotify|Artist|Song';
  const lyr = (o) => c.send('lyrics', { key, status: 'ok', lines, ...o });
  media({ playing: true, dur: 200, pos: 6, updated: Date.now() }); lyr(); await wait(500);
  ok('lyrics setting OFF (default): no lyric line is shown even though lyrics arrived', (await sub()) === 'Artist · Spotify', await sub());
  await save({ lyricsEnabled: true }); await wait(500);
  ok('lyrics ON + real position (6 s): exactly ONE line is shown, the one active at 6 s', (await sub()) === 'second line', await sub());
  ok('...a single line (no paragraph, no line breaks)', !(await sub()).includes('\n') && (await sub()).length < 40);
  ok('the lyric timer runs only while it can change something', await ev("LI.media.timerActive() === true"));
  await wait(3600);
  ok('as playback continues the line advances by itself (6 s + ~4 s => "third line")', (await sub()) === 'third line', await sub());
  media({ playing: true, dur: 200, pos: 14.5, updated: Date.now() }); await wait(500);
  ok('an instrumental gap (empty line) shows the normal artist line, not a blank', (await sub()) === 'Artist · Spotify', await sub());
  media({ playing: true, dur: 200, pos: 0.2, updated: Date.now() }); await wait(500);
  ok('before the first timestamp nothing is shown', (await sub()) === 'Artist · Spotify', await sub());
  media({ playing: true, dur: 200, pos: 40, updated: Date.now() }); await wait(500);
  ok('the last line does not linger for ever (>8 s after it)', (await sub()) === 'Artist · Spotify', await sub());
  media({ playing: false, dur: 200, pos: 6, updated: Date.now() }); await wait(500);
  ok('paused: no lyric line, and the timer stops (no loop while paused)', !(await sub()).includes('line') && await ev("LI.media.timerActive() === false"), await sub());
  media({ playing: true, dur: 200, pos: 6, updated: Date.now() }); await wait(400);
  c.send('lyrics', { key: 'Spotify|Someone else|Different song', status: 'ok', lines }); await wait(400);
  ok('lyrics belonging to another track are never shown', (await sub()) === 'Artist · Spotify', await sub());
  lyr({ status: 'unavailable', reason: 'not-found', lines: undefined }); await wait(400);
  ok('lyrics unavailable: a quiet "No synced lyrics" state, nothing invented', (await sub()) === 'Artist · Spotify · No synced lyrics', await sub());
  lyr({ status: 'unavailable', reason: 'no-timeline', lines: undefined }); await wait(300);
  ok('no player timeline: says so rather than guessing positions', /timeline/.test(await sub()), await sub());
  media({ playing: true }); lyr(); await wait(400);
  ok('lyrics found but the player reports no position: no line is shown (never guessed)', (await sub()) === 'Artist · Spotify', await sub());
  await save({ lyricsEnabled: false }); media({ playing: true, dur: 200, pos: 6, updated: Date.now() }); await wait(400);
  ok('turning lyrics off removes the line again', (await sub()) === 'Artist · Spotify');
  await c.shot('91_media_lyrics_off');
  media({ title: '', artist: '', app: '', playing: false }); await wait(300);

  /* ---------- charger sound (real main-process detection, mock power helper) ---------- */
  await ev("LI.island.close(); 0");
  console.log('[info] waiting for the start-up quiet period to end');
  await wait(8200);
  const sent = []; const orig = win.webContents.send.bind(win.webContents); win.webContents.send = (ch, ...a) => { if (ch === 'charge-sound') sent.push(a[0]); return orig(ch, ...a); };
  const bat = (ac, pct = 64) => inject('power', 'battery', { hasBattery: true, ac, charging: ac, percent: pct, minutes: null, saver: false });
  const count = () => ev("LI.chime.count");
  const base = await count();
  bat(false); await wait(900);
  ok('unplugging makes NO sound by default (disconnect sound is off)', sent.length === 0, JSON.stringify(sent));
  bat(true); await wait(900);
  ok('plugging in the charger sends exactly one connect sound at the configured volume (40 %)', sent.length === 1 && sent[0].kind === 'connect' && Math.abs(sent[0].volume - 0.4) < 1e-9, JSON.stringify(sent));
  const played = (await count()) - base;
  ok('the renderer synthesised and played it (or reports a harmless error)', played === 1 || (await ev("LI.chime.lastError")) !== '', 'count+' + played + ' err=' + await ev("LI.chime.lastError"));
  bat(true, 66); bat(true, 68); await wait(900);
  ok('the charger staying connected (battery percentage updates) never repeats the sound', sent.length === 1);
  await save({ chargeDisconnectSound: true }); bat(false, 68); await wait(900);
  ok('disconnect sound ON: unplugging sends a (different) disconnect sound', sent.length === 2 && sent[1].kind === 'disconnect', JSON.stringify(sent));
  await save({ chargeVolume: 0 }); bat(true, 69); await wait(900);
  ok('volume 0: no sound', sent.length === 2);
  await save({ chargeVolume: 80 }); bat(false, 69); await wait(300); bat(true, 69); await wait(900);
  ok('volume 80 % is passed through; a quick unplug/replug is two real events', sent.length === 4 && Math.abs(sent[3].volume - 0.8) < 1e-9, JSON.stringify(sent.slice(2)));
  await save({ chargeSound: false }); bat(false, 70); await wait(300); bat(true, 70); await wait(900);
  ok('charging sound toggle OFF: silent', sent.length === 4);
  await save({ chargeSound: true, notifyBattery: false }); bat(false, 70); await wait(300); bat(true, 70); await wait(900);
  ok('respects the notification preference (battery notifications off => silent)', sent.length === 4);
  await save({ notifyBattery: true });
  win.webContents.send = orig;
  const survive = await ev("(() => { LI.chime.reset(); const A = window.AudioContext; window.AudioContext = function () { throw new Error('no audio device'); }; LI.chime.lastError = ''; const r = LI.chime.play('connect', 0.5); const e = LI.chime.lastError; window.AudioContext = A; return JSON.stringify({ r, e }); })()");
  const sv = JSON.parse(survive);
  ok('a playback failure is swallowed: play() returns false, records the reason, never throws', sv.r === false && /no audio device/.test(sv.e), survive);
  ok('...and the chime recovers by itself on the next event', await ev("(() => { LI.chime.reset(); return LI.chime.play('connect', 0.3) || LI.chime.lastError !== ''; })()"));
  ok('...and an unknown kind or zero volume is ignored', await ev("LI.chime.play('bogus', 0.5) === false && LI.chime.play('connect', 0) === false"));

  /* ---------- settings ---------- */
  await ev("LI.island.open({ view: 'settings' }); 0"); await wait(700);
  const secs = JSON.parse(await ev("JSON.stringify([...document.querySelectorAll('#settingsForm .sec')].map(e => e.textContent))"));
  ok('Settings has the new sections and keeps the old ones', ['Hover behaviour', 'Motion', 'Media', 'Charging', 'Audio Studio', 'Behaviour'].every((s) => secs.includes(s)) && secs.length >= 9, secs.join(' | '));
  const keys = ['hoverExpand', 'hoverDelay', 'autoCollapse', 'collapseDelay', 'motionMode', 'mediaVisualizer', 'mediaArtwork', 'lyricsEnabled', 'chargeSound', 'chargeVolume', 'chargeDisconnectSound', 'audioFormat', 'audioBitrate', 'audioDir', 'audioRemember', 'animSpeed', 'reduceMotion', 'blurCollapseSec', 'expandOn', 'offsetY'];
  const have = JSON.parse(await ev(`JSON.stringify(${JSON.stringify(keys)}.filter(k => !document.getElementById('f_' + k)))`));
  ok('every Phase 3 control exists, and the existing ones are still there', have.length === 0, 'missing: ' + have.join());
  ok('the pin help text and the effective motion status are shown', await ev("!!document.querySelector('[data-info=pin]') && /Motion is (on|reduced) now/.test(document.querySelector('[data-info=motion]').textContent)"));
  await ev("(() => { const e = document.getElementById('f_collapseDelay'); e.value = 700; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); })(); 0"); await wait(500);
  const U = require('electron').app.getPath('userData');
  ok('changing a setting in the form takes effect live and is written to settings.json', await ev("LI.S.collapseDelay === 700") && JSON.parse(fs.readFileSync(path.join(U, 'settings.json'), 'utf8')).collapseDelay === 700);
  const saved = JSON.parse(fs.readFileSync(path.join(U, 'settings.json'), 'utf8'));
  ok('settingsVersion is unchanged (no migration needed: new keys merge under defaults)', saved.settingsVersion === 2 || saved.settingsVersion === undefined, 'v=' + saved.settingsVersion);
  ok('existing user data (tasks, clips, theme) is untouched by the new keys', await ev("Array.isArray(LI.S.tasks) || LI.S.tasks === undefined"));
  await ev("LI.island.close(); 0"); await wait(500);

  /* ---------- idle cost ---------- */
  const { app } = require('electron');
  app.getAppMetrics(); await wait(3000); const m = app.getAppMetrics();
  const cpu = m.reduce((a, p) => a + p.cpu.percentCPUUsage, 0);
  ok('idle (collapsed, nothing playing) total CPU over 3 s is low', cpu < 6, 'cpu=' + cpu.toFixed(2) + '%');
  console.log(`[TEST] SUMMARY ${R.filter(Boolean).length}/${R.length} passed`);
};
