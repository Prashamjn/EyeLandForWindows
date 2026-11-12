'use strict';
// Charger sound: a short, soft, ORIGINAL two-note chime synthesised here with WebAudio (no recordings, no files). Connecting rises,
// the optional disconnect sound falls and is lower and shorter. The main process only sends 'charge-sound' for a real charger event
// that passed the settings / mute / notification checks (src/system/notify.js), so there is no repeat while the charger stays connected.
// Playback failure of any kind is swallowed: it must never disturb the app.
(() => {
  let ctx = null, last = 0;
  const NOTES = { connect: [[659.25, 0, 0.16], [987.77, 0.11, 0.34]], disconnect: [[783.99, 0, 0.12], [523.25, 0.09, 0.26]] };   // [Hz, start s, length s]
  LI.chime = {
    count: 0, lastError: '',
    play(kind, volume) {
      try {
        const now = performance.now(); if (now - last < 1200) return false; last = now;          // belt and braces against double events
        const notes = NOTES[kind]; if (!notes) return false;
        const vol = Math.max(0, Math.min(1, +volume)); if (!(vol > 0)) return false;
        ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
        if (ctx.state === 'suspended') ctx.resume().catch(() => {});
        const t0 = ctx.currentTime + 0.02, master = ctx.createGain();
        master.gain.value = 0.22 * vol; master.connect(ctx.destination);                           // soft: at most ~22% of full scale
        for (const [hz, at, len] of notes) {
          const o = ctx.createOscillator(), g = ctx.createGain();
          o.type = 'sine'; o.frequency.value = hz;
          g.gain.setValueAtTime(0.0001, t0 + at);
          g.gain.exponentialRampToValueAtTime(1, t0 + at + 0.012);                                  // short attack: no click
          g.gain.exponentialRampToValueAtTime(0.0001, t0 + at + len + 0.18);                        // gentle decay
          o.connect(g); g.connect(master); o.start(t0 + at); o.stop(t0 + at + len + 0.2);
          o.onended = () => { try { o.disconnect(); g.disconnect(); } catch { /* gone */ } };
        }
        setTimeout(() => { try { master.disconnect(); } catch { /* gone */ } }, 1500);
        this.count++; return true;
      } catch (e) { this.lastError = String(e && e.message || e); return false; }
    },
  };
})();
