'use strict';
// Focus timer, clipboard history, tasks and settings. Behaviour carried over from the previous island.
(() => {
  const { $, $$, el, icon } = LI;

  /* ================= focus timer ================= */
  const T = { mode: 'focus', total: 1500, remaining: 1500, running: false, endAt: 0, sessions: 0, iv: 0 };
  const fmt = (s) => String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(Math.max(0, s % 60)).padStart(2, '0');
  const timerLength = (m) => ((m === 'focus' ? LI.S.focusMin : LI.S.breakMin) || (m === 'focus' ? 25 : 5)) * 60;
  const started = () => T.remaining < T.total;

  function setTimerMode(m) { stopTick(); T.mode = m; T.total = T.remaining = timerLength(m); T.running = false; paintTimer(); }
  function toggleTimer() {
    if (T.running) { T.running = false; stopTick(); }
    else { T.running = true; T.endAt = Date.now() + T.remaining * 1000; startTick(); }
    paintTimer();
  }
  function resetTimer() { stopTick(); T.running = false; T.remaining = T.total; paintTimer(); }
  const startTick = () => { stopTick(); T.iv = setInterval(tick, 250); };       // only ticks while running
  const stopTick = () => { clearInterval(T.iv); T.iv = 0; };
  function tick() {
    T.remaining = Math.max(0, Math.round((T.endAt - Date.now()) / 1000));
    if (T.remaining === 0) return finishTimer();
    paintTimer();
  }
  function finishTimer() {
    stopTick(); T.running = false;
    const wasFocus = T.mode === 'focus';
    if (wasFocus) T.sessions++;
    const title = wasFocus ? 'Focus session complete' : 'Break is over', body = wasFocus ? 'Time for a break.' : 'Ready for another round?';
    try { new Notification(title, { body, silent: false }); } catch {}
    LI.activity.show({ id: 'timer-done', kind: 'notice', icon: 'bell', title: wasFocus ? 'Focus complete' : 'Break is over', sub: body.replace(/\.$/, ''), tone: 'success' }, { ttl: 4000 });
    setTimerMode(wasFocus ? 'break' : 'focus');
  }
  function timerActivity() {
    if (!started()) return null;
    return {
      id: 'timer', kind: 'timer', icon: 'timer', title: T.mode === 'focus' ? 'Focus session' : 'Break', sub: T.running ? 'Running' : 'Paused',
      value: fmt(T.remaining), progress: ((T.total - T.remaining) / T.total) * 100,
      controls: [{ id: 'toggle', icon: T.running ? 'pauseF' : 'play', label: T.running ? 'Pause' : 'Resume', primary: true, onClick: toggleTimer }],
    };
  }
  function indicators() {
    LI.island.indicators({ coffee: LI.state.coffee, timerText: started() ? fmt(T.remaining) : '', timerRunning: T.running });
  }
  function paintTimer() {
    const t = fmt(T.remaining), s = started();
    $('#timerBig').textContent = t;
    $('#timerToggle').textContent = T.running ? 'Pause' : s ? 'Resume' : 'Start';
    $('#timerFill').style.width = ((T.total - T.remaining) / T.total) * 100 + '%';
    $$('[data-tmode]').forEach((b) => b.classList.toggle('on', b.dataset.tmode === T.mode));
    $('#timerCount').textContent = `${T.sessions} focus session${T.sessions === 1 ? '' : 's'} completed`;
    LI.activity.setBase('timer', timerActivity());
    indicators();
  }
  $('#timerToggle').addEventListener('click', toggleTimer);
  $('#timerReset').addEventListener('click', resetTimer);
  $$('[data-tmode]').forEach((b) => b.addEventListener('click', () => setTimerMode(b.dataset.tmode)));

  /* ================= clipboard history ================= */
  function paintClips() {
    const box = $('#clipList'); box.replaceChildren();
    const empty = (t, s) => el('div', { class: 'empty', html: icon('clipboard') }, el('span', { class: 't', text: t }), el('span', { text: s }));
    if (!LI.S.clipboardHistory) return box.append(empty('Clipboard history is off', 'Turn it on in Settings.'));
    if (!LI.state.clips.length) return box.append(empty('Nothing copied yet', 'Text you copy will show up here.'));
    LI.state.clips.forEach((c) => { const b = el('button', { title: 'Click to copy again', text: c.replace(/\s+/g, ' ').trim() }); b._text = c; box.append(b); });
  }
  $('#clipList').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b && b._text != null) api.copyClip(b._text); });
  $('#clipClear').addEventListener('click', () => api.clearClips());

  /* ================= tasks ================= */
  const taskInput = $('#taskInput');
  const saveTodos = (list) => { LI.S.todos = list; api.saveSettings({ todos: list }); paintTasks(); };
  function paintTasks() {
    const box = $('#taskList'); box.replaceChildren();
    const list = [...(LI.S.todos || [])].sort((a, b) => a.done - b.done);
    if (!list.length) return box.append(el('div', { class: 'empty', html: icon('todo') }, el('span', { class: 't', text: 'No tasks yet' }), el('span', { text: 'Type above and press Enter.' })));
    list.forEach((t) => {
      const cb = el('input', { type: 'checkbox', 'aria-label': 'Done' }); cb.checked = !!t.done;
      cb.addEventListener('change', () => saveTodos(LI.S.todos.map((x) => (x.id === t.id ? { ...x, done: cb.checked } : x))));
      const del = el('button', { class: 'task-del', 'aria-label': 'Delete task', html: icon('close') });
      del.addEventListener('click', () => saveTodos(LI.S.todos.filter((x) => x.id !== t.id)));
      box.append(el('div', { class: 'task' + (t.done ? ' done' : '') }, cb, el('span', { text: t.text }), del));
    });
  }
  function addTask() {
    const text = taskInput.value.trim(); if (!text) return;
    saveTodos([{ id: Math.random().toString(36).slice(2, 10), text, done: false, created: Date.now() }, ...(LI.S.todos || [])]);
    taskInput.value = '';
  }
  $('#taskAdd').addEventListener('click', addTask);
  taskInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') addTask(); });
  // the island window is not focusable by default, so allow typing only while the box is in use
  taskInput.addEventListener('mousedown', () => { api.setFocusable(true); setTimeout(() => taskInput.focus(), 60); });
  taskInput.addEventListener('blur', () => { api.setFocusable(false); if (!LI.island.isInside()) LI.island.scheduleClose(); });

  /* ================= settings ================= */
  const FIELDS = [
    { k: 'theme', l: 'Theme', t: 'select', o: [['black', 'Obsidian'], ['graphite', 'Graphite'], ['midnight', 'Midnight'], ['light', 'Light']] },
    { k: 'accent', l: 'Accent', t: 'select', o: [['blue', 'Blue'], ['white', 'White'], ['green', 'Green']] },
    { k: 'animSpeed', l: 'Motion speed', t: 'range', min: 0.5, max: 2, step: 0.1 },
    { k: 'position', l: 'Position', t: 'select', o: [['top', 'Top'], ['bottom', 'Bottom']] },
    { k: 'offsetY', l: 'Edge gap', t: 'range', min: 0, max: 40, step: 1 },
    { k: 'hoverDelay', l: 'Open delay (ms)', t: 'range', min: 0, max: 600, step: 20 },
    { k: 'overlayMs', l: 'Activity time (ms)', t: 'range', min: 800, max: 4000, step: 100 },
    { k: 'focusMin', l: 'Focus (min)', t: 'number', min: 1, max: 120 },
    { k: 'breakMin', l: 'Break (min)', t: 'number', min: 1, max: 60 },
    { k: 'tempUnit', l: 'Temperature', t: 'select', o: [['c', '°C'], ['f', '°F']] },
    { k: 'showBattery', l: 'Show battery', t: 'checkbox', dflt: true },
    { k: 'clipboardHistory', l: 'Clipboard history', t: 'checkbox' },
    { k: 'hideInFullscreen', l: 'Hide in full screen', t: 'checkbox' },
    { k: 'autostart', l: 'Start with Windows', t: 'checkbox' },
  ];
  const fieldEls = {};
  const rangeFill = (el_, f) => el_.style.setProperty('--p', ((el_.value - f.min) / (f.max - f.min)) * 100 + '%');
  const valueOf = (f) => (LI.S[f.k] !== undefined ? LI.S[f.k] : f.dflt !== undefined ? f.dflt : f.t === 'select' ? f.o[0][0] : undefined);

  function buildSettings() {
    const form = $('#settingsForm'); form.replaceChildren();
    FIELDS.forEach((f) => {
      let input;
      if (f.t === 'select') input = el('select', {}, f.o.map(([v, l]) => el('option', { value: v, text: l })));
      else { input = el('input', { type: f.t }); if (f.min !== undefined) { input.min = f.min; input.max = f.max; } if (f.step) input.step = f.step; }
      input.id = 'f_' + f.k; fieldEls[f.k] = input;
      input.addEventListener('input', () => {
        const v = f.t === 'checkbox' ? input.checked : (f.t === 'range' || f.t === 'number') ? +input.value : input.value;
        const prev = { ...LI.S };
        LI.S[f.k] = v; api.saveSettings({ [f.k]: v });
        if (f.t === 'range') rangeFill(input, f);
        LI.applySettings(prev);
        if (f.k === 'focusMin' || f.k === 'breakMin') { if (!T.running && T.remaining === T.total) setTimerMode(T.mode); }
      });
      form.append(el('div', { class: 'field' }, el('label', { for: 'f_' + f.k, text: f.l }), input));
    });
    const sc = el('button', { class: 'link-btn', text: 'Plugin shortcuts' }); sc.addEventListener('click', () => api.openHub('shortcuts'));
    const q = el('button', { class: 'quit', text: 'Quit Liquid Island' }); q.addEventListener('click', () => api.quit());
    form.append(el('div', { class: 'foot' }, sc, q));
    syncSettings();
  }
  // reflect the current settings in the form (also used when another window, e.g. the plugin hub, changes them)
  function syncSettings() {
    FIELDS.forEach((f) => {
      const input = fieldEls[f.k]; if (!input || document.activeElement === input) return;
      const v = valueOf(f);
      if (f.t === 'checkbox') input.checked = !!v; else input.value = v;
      if (f.t === 'range') rangeFill(input, f);
    });
  }

  LI.panels = {
    paintTimer, setTimerMode, indicators, paintClips, paintTasks, buildSettings, syncSettings,
    onClips(list) { LI.state.clips = list; paintClips(); },
    onSettings() { paintClips(); paintTasks(); syncSettings(); },
  };
})();
