'use strict';
// Now Playing: turns the media session (native/media.ps1) into the activity area, the capsule visualizer and the synced lyric line.
// Everything shown comes from real playback state: the visualizer animates only while the player reports "playing"; a lyric line is
// shown only when timestamped lyrics were found AND the player reports a real position. No timer runs unless a lyric line can change.
(() => {
  const APPS = [['spotify', 'Spotify'], ['msedge', 'Edge'], ['chrome', 'Chrome'], ['firefox', 'Firefox'], ['brave', 'Brave'], ['opera', 'Opera'], ['vlc', 'VLC'], ['applemusic', 'Apple Music'], ['itunes', 'iTunes'], ['zunemusic', 'Media Player'], ['mediaplayer', 'Media Player'], ['youtube', 'YouTube']];
  function appName(id) {
    const raw = String(id || ''); const k = raw.toLowerCase().replace(/[^a-z]/g, '');
    for (const [p, n] of APPS) if (k.includes(p)) return n;
    return raw.split('!').pop().replace(/\.exe$/i, '').slice(0, 24);
  }
  const ART = /^[A-Za-z0-9+/=]{100,}$/;
  let m = { title: '', artist: '', app: '', playing: false }, art = '', trackKey = '';
  let lyr = { key: '', status: 'off', lines: null }, timer = 0, lastSub = null;
  const keyOf = (x) => [x.app, x.artist, x.title].join('|');

  // playback position now, extrapolated from the player's last report; null when the player gave no timeline
  function position(now = Date.now()) {
    if (!(m.dur > 0) || typeof m.pos !== 'number') return null;
    const p = m.playing && m.updated ? m.pos + Math.max(0, (now - m.updated) / 1000) : m.pos;
    return Math.max(0, Math.min(m.dur, p));
  }
  // the one lyric line to show right now, or ''
  function lyricLine(pos) {
    if (LI.S.lyricsEnabled !== true || lyr.status !== 'ok' || !lyr.lines || lyr.key !== keyOf(m) || !m.playing || pos == null) return '';
    let i = -1; for (let k = lyr.lines.length - 1; k >= 0; k--) if (lyr.lines[k].t <= pos) { i = k; break; }
    if (i < 0) return '';
    const l = lyr.lines[i], next = lyr.lines[i + 1];
    if (!next && pos - l.t > 8) return '';                 // the last line does not linger
    return l.text || '';                                   // an empty line is an instrumental gap
  }
  function subText(line) {
    if (line) return line;
    const parts = [m.artist, m.app ? appName(m.app) : ''].filter(Boolean);
    if (m.title && !m.playing) parts.push('Paused');
    if (LI.S.lyricsEnabled === true && m.playing && lyr.key === keyOf(m) && lyr.status === 'unavailable') parts.push(lyr.reason === 'no-timeline' ? 'Lyrics need a player timeline' : 'No synced lyrics');
    return parts.join(' · ');
  }
  function activity(line) {
    const can = m.can || {};
    const useArt = art && LI.S.mediaArtwork !== false;
    return {
      id: 'media', kind: 'media', icon: 'music', art: useArt ? 'data:image/jpeg;base64,' + art : undefined, title: m.title, sub: subText(line), mini: 'media',
      controls: [
        { id: 'prev', icon: 'prev', label: 'Previous', disabled: can.prev === false, onClick: () => api.media('prev') },
        { id: 'play', icon: m.playing ? 'pauseF' : 'play', label: m.playing ? 'Pause' : 'Play', primary: true, disabled: can.play === false, onClick: () => api.media('play') },
        { id: 'next', icon: 'next', label: 'Next', disabled: can.next === false, onClick: () => api.media('next') },
      ],
    };
  }
  function render() {
    const line = lyricLine(position());
    LI.activity.setBase('media', m.title ? activity(line) : null);
    LI.panels && LI.panels.indicators();
    lastSub = subText(line);
  }
  // 4 Hz, and only while a lyric line can actually change (synced lyrics found, playing, island open)
  function syncTimer() {
    const need = LI.S.lyricsEnabled === true && lyr.status === 'ok' && m.playing && m.dur > 0 && lyr.key === keyOf(m);
    if (need && !timer) timer = setInterval(() => { if (LI.island.state !== 'full') return; if (subText(lyricLine(position())) !== lastSub) render(); }, 250);
    else if (!need && timer) { clearInterval(timer); timer = 0; }
  }

  let seen = false;
  LI.media = {
    appName, position, lyricLine, timerActive: () => !!timer,
    onMedia(x) {
      x = x || {};
      const k = keyOf(x), changed = k !== trackKey;
      if (changed) { trackKey = k; art = ''; }
      if (x.art && ART.test(x.art)) art = x.art;            // the artwork arrives once per track (possibly a moment after the title)
      const prev = m; m = x; LI.state.media = x;
      render(); syncTimer();
      // a new track while playing gets a brief mini presentation (never on the very first reading at startup)
      if (seen && x.title && x.playing && x.title !== prev.title) LI.island.mini(activity(''), 3200);
      seen = true;
    },
    onLyrics(l) { lyr = l || { key: '', status: 'off' }; render(); syncTimer(); },
    rerender() { render(); syncTimer(); },
  };
  LI.bus.on('settings', () => { if (trackKey || lyr.key) LI.media.rerender(); });
})();
