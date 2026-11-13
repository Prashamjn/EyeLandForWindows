'use strict';
// Motion system (Phase 3): one set of durations and easings for the whole app, a tiny Web Animations helper, and the single
// source of truth for "is motion reduced right now". The same numbers exist as CSS tokens in tokens.css (--dur-*).
//
// Reduced motion = the "Reduce motion" checkbox, OR the OS preference unless Settings > Motion is "Always animate".
// Windows' "Animation effects" switch makes Chromium report a reduced-motion preference; the override exists so that switch
// being off does not silently remove every animation from this app. Default: respect the OS.
(() => {
  const DUR = { ui: 150, nav: 210, expand: 300, collapse: 240, notice: 260 };
  const EASE = { out: 'cubic-bezier(.32,.72,0,1)', std: 'cubic-bezier(.4,0,.2,1)', in: 'cubic-bezier(.4,0,1,1)' };
  const mq = matchMedia('(prefers-reduced-motion: reduce)');
  const speed = () => Math.max(0.25, +(LI.S && LI.S.animSpeed) || 1);

  function status() {
    const os = mq.matches, setting = !!(LI.S && LI.S.reduceMotion), mode = (LI.S && LI.S.motionMode) === 'always' ? 'always' : 'system';
    const reduced = setting ? true : mode === 'always' ? false : os;
    const why = setting ? 'The Reduce motion setting is on' : mode === 'always' ? (os ? 'Windows animation effects are off, but Liquid Island is set to always animate' : 'Animations are on') : os ? 'Windows animation effects are off (Settings > Accessibility > Visual effects)' : 'Animations are on';
    return { os, setting, mode, reduced, why };
  }
  const reduced = () => status().reduced;
  const ms = (name) => (DUR[name] || +name || DUR.ui) / speed();

  function apply() {
    const r = reduced();
    document.body.classList.toggle('reduce-motion', r);
    document.body.dataset.motion = r ? 'reduced' : 'full';
    LI.bus.emit('motion', status());
  }
  mq.addEventListener('change', apply);
  LI.bus.on('settings', apply);

  // animate(el, keyframes, { dur: 'ui'|'nav'|..., easing: 'out'|'std'|'in', delay }) -> Animation, or null when motion is reduced
  function animate(el, frames, { dur = 'ui', easing = 'out', delay = 0, fill = 'backwards' } = {}) {
    if (!el || reduced() || !el.animate) return null;
    return el.animate(frames, { duration: ms(dur), easing: EASE[easing] || easing, delay, fill });
  }
  const finished = (a) => (a ? a.finished.catch(() => {}) : Promise.resolve());

  const FROM = { up: 'translateY(8px)', down: 'translateY(-8px)', back: 'translateX(-10px)', fwd: 'translateX(10px)', scale: 'scale(.98)', none: 'none' };
  // content arriving (navigation): opacity + a few px of movement
  const enter = (el, kind = 'up', o = {}) => animate(el, [{ opacity: 0, transform: FROM[kind] || FROM.up }, { opacity: 1, transform: 'none' }], { dur: 'nav', easing: 'out', ...o });
  // content leaving: resolves when done (immediately when motion is reduced)
  const leave = (el, kind = 'down', o = {}) => finished(animate(el, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: FROM[kind] || FROM.down }], { dur: 'ui', easing: 'in', fill: 'forwards', ...o }));
  // a list appearing one item after another (a few ms apart)
  const stagger = (els, kind = 'up', step = 22) => els.forEach((e, i) => enter(e, kind, { dur: 'ui', delay: Math.min(i * step, 220) / speed() }));
  // restrained pulse for "working" icons; returns a stop function
  const pulse = (el) => { const a = animate(el, [{ opacity: 1 }, { opacity: .55 }, { opacity: 1 }], { dur: 1600, easing: 'std', fill: 'none' }); if (a) a.effect.updateTiming({ duration: 1600, iterations: Infinity }); return () => a && a.cancel(); };

  LI.reduceMotion = reduced;                              // every existing caller (workspace, Control Centre) now follows this
  LI.motion = { DUR, EASE, ms, animate, enter, leave, stagger, pulse, finished, status, reduced, apply };
})();
