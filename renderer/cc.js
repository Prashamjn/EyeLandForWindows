'use strict';
// Control Centre. A thin view over the real system state kept by src/system (main process):
//  - state arrives as 'cc' events on the bus; nothing here assumes a change worked until the backend reports it
//  - every action goes through window.cc.call(op, args) -> { ok, data | error, code }
//  - features Windows cannot control show their real status and a clearly labelled "Open Windows Settings" shortcut instead
(() => {
  const { $, el, icon, volIcon, debounce } = LI;
  const st = { audio: null, mic: null, wifi: null, vpn: null, bt: null, battery: null, powermode: null, bri: undefined, briError: null, displays: null, unavailable: {} };
  const ui = { limited: null, pane: null, nets: null, scanning: false, picked: null, pwd: '', busy: {}, err: {}, act: {}, found: [], btScanning: false, loaded: false };
  let root = null, over = null, body = null, dragging = false;
  const MODES = [['efficiency', 'Best power efficiency', 'leaf'], ['balanced', 'Balanced', 'balance'], ['performance', 'Best performance', 'rocket']];
  const HEADSET = /head(phone|set)|buds|airpods|earbud|earphone|pods/i;
  const outIcon = (n, form) => (form === 3 || form === 5 || HEADSET.test(n || '') ? 'headphones' : 'speaker');
  const KIND_ICON = { audio: 'headphones', phone: 'phone', computer: 'laptop', peripheral: 'mouse', other: 'bluetooth' };

  const call = async (op, arg, { quiet } = {}) => {
    const r = await window.cc.call(op, arg);
    if (!r.ok && !quiet) LI.toast(r.error || 'That did not work', true);
    return r;
  };
  const unavailable = (k) => st.unavailable[k];
  const LOCATION = { op: 'settings.open', page: 'location', label: 'Open location settings' };
  const HELPER_KEY = { audio: 'audio', net: 'net', bt: 'bt', power: 'power' };
  // an error from Windows is shown as received; when a code has a fix (a Settings page) a button for it is shown with the message
  const fail = (key, r) => { ui.err[key] = r.error || 'That did not work'; ui.act[key] = r.action || null; };
  const errNote = (key) => {
    const box = el('div', { class: 'cc-errbox' }, el('p', { class: 'cc-note bad', text: ui.err[key] }));
    const a = ui.act[key]; if (a) box.append(el('button', { class: 'btn sm', text: a.label, onclick: () => call(a.op, { page: a.page }, { quiet: true }) }));
    return box;
  };

  /* ================= state ================= */
  LI.bus.on('cc', (m) => {
    if (m.kind === 'state') { st[m.key] = m.data; if (m.key === 'wifi' && ui.busy.wifi && m.data.state !== 'connecting') { ui.busy.wifi = null; } }
    else if (m.kind === 'progress' && m.key === 'wifi') { ui.busy.wifi = m.phase === 'connecting' ? m.ssid : null; if (m.phase === 'failed') { ui.err.wifi = 'Windows could not connect to ' + (m.ssid || 'the network') + '.'; ui.act.wifi = null; } }
    else if (m.kind === 'scan' && m.key === 'bt') { ui.found = m.data.devices || []; ui.btScanning = !m.data.done; }
    else if (m.kind === 'helper' && m.up === false && m.failed) st.unavailable[HELPER_KEY[m.helper]] = { message: 'This helper stopped working.' };
    else if (m.kind === 'helper' && m.up === true && st.unavailable[HELPER_KEY[m.helper]]) { delete st.unavailable[HELPER_KEY[m.helper]]; load(); }       // recovered: stop showing the old failure
    if (LI.workspace.route().type === 'cc') paint();
  });
  LI.bus.on('settings', () => { if (LI.workspace.route().type === 'cc' && !ui.pane) paintOverview(); });

  async function load() {
    const r = await call('state.all', {}, { quiet: true });
    if (r.ok) { const { unavailable: un, ...rest } = r.data; Object.assign(st, rest); st.unavailable = un || {}; }
    ui.loaded = true; paint();
  }

  /* ================= overview ================= */
  const tile = (id, ic, onToggle) => {
    const t = el('div', { class: 'tile', 'data-pane': id },
      el('button', { class: 't-main', 'data-open': id }, el('span', { class: 't-ico', html: icon(ic) }), el('span', { class: 't-txt' }, el('b', { class: 't-title' }), el('small', { class: 't-sub' }))));
    if (onToggle) t.append(el('button', { class: 't-sw', role: 'switch', 'aria-checked': 'false', 'data-toggle': id, 'aria-label': 'Toggle' }, el('i')));
    return t;
  };
  function buildOverview() {
    over = el('div', { class: 'cc-over' },
      el('div', { class: 'cc-top' }, tile('wifi', 'wifi', 1), tile('bt', 'bluetooth', 1), tile('vpn', 'vpn'), tile('battery', 'battery')),
      el('div', { class: 'cc-card cc-sliders' },
        el('div', { class: 'cc-slide' }, el('button', { class: 'cc-ib', 'data-act': 'mute', 'aria-label': 'Mute' }), el('div', { class: 'cc-sl' }, el('span', { class: 'cc-lbl', text: 'Volume' }), el('input', { type: 'range', min: 0, max: 100, id: 'ccVol', 'aria-label': 'Volume' })), el('span', { class: 'cc-num', id: 'ccVolN' })),
        el('div', { class: 'cc-slide', id: 'ccBriRow' }, el('span', { class: 'cc-ib static', html: icon('sun') }), el('div', { class: 'cc-sl' }, el('span', { class: 'cc-lbl', text: 'Brightness' }), el('input', { type: 'range', min: 0, max: 100, id: 'ccBri', 'aria-label': 'Brightness' })), el('span', { class: 'cc-num', id: 'ccBriN' })),
        el('button', { class: 'cc-out', 'data-open': 'audio' }, el('span', { class: 'cc-ib static', id: 'ccOutI' }), el('span', { class: 'cc-outtxt' }, el('small', { text: 'Sound output' }), el('b', { id: 'ccOutN' })), el('span', { class: 'cc-chev', html: icon('right') }))),
      el('div', { class: 'cc-bot', id: 'ccBot' }, tile('mic', 'mic', 1), tile('power', 'gauge'), tile('night', 'moon'), tile('display', 'display'), tile('charging', 'plug')));
    wireSlider($('#ccVol', over), $('#ccVolN', over), debounce((v) => call('audio.setVolume', { value: v }, { quiet: true }), 60));
    wireSlider($('#ccBri', over), $('#ccBriN', over), debounce((v) => call('bri.set', { value: v }, { quiet: true }), 120));
    over.addEventListener('click', onOverviewClick);
  }
  function wireSlider(r, num, push) {
    r.addEventListener('pointerdown', () => { dragging = true; });
    r.addEventListener('input', () => { r.style.setProperty('--p', r.value + '%'); num.textContent = r.value; push(+r.value); });
  }
  window.addEventListener('pointerup', () => { dragging = false; });

  const setTile = (id, { title, sub, on, sw, dim, ic }) => {
    const t = $(`.tile[data-pane="${id}"]`, over); if (!t) return;
    $('.t-title', t).textContent = title; $('.t-sub', t).textContent = sub || '';
    t.classList.toggle('on', !!on); t.classList.toggle('dim', !!dim);
    if (ic) $('.t-ico', t).innerHTML = icon(ic);
    const s = $('.t-sw', t); if (s) { s.setAttribute('aria-checked', String(!!sw)); s.classList.toggle('on', !!sw); s.disabled = !!dim; }
  };
  const fmtMin = (m) => (m == null ? '' : m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`);
  const batText = (b) => (!b || !b.hasBattery ? 'No battery' : (b.percent != null ? b.percent + '%' : '') + (b.charging ? ' · Charging' : b.ac ? ' · Plugged in' : ' · On battery'));

  function paintOverview() {
    const S = LI.S, un = unavailable;
    const w = st.wifi, b = st.bt, v = st.vpn, a = st.audio, m = st.mic, bat = st.battery, pm = st.powermode, d = st.displays;
    // Wi-Fi
    const wOff = w && (w.radio === 'off' || w.radio === 'disabled'), wErr = w && w.radio === 'error', wNone = !w || w.radio === 'unsupported' || (w.state === 'none' && !wErr) || wErr || un('net');
    setTile('wifi', { title: 'Wi-Fi', ic: wOff || wNone ? 'wifiOff' : 'wifi', dim: wNone, on: w && w.state === 'connected', sw: w && w.radio === 'on',
      sub: un('net') ? 'Unavailable' : !w ? 'Loading…' : wErr ? 'Windows error' : w.state === 'none' ? 'No adapter' : wOff ? 'Off' : w.state === 'connecting' ? 'Connecting…' : w.state === 'connected' ? (w.ssid || 'Connected') : 'Not connected' });
    // Bluetooth
    const connected = b && b.devices ? b.devices.filter((x) => x.connected) : [];
    setTile('bt', { title: 'Bluetooth', dim: !b || b.radio === 'unsupported' || b.radio === 'error' || un('bt'), on: b && b.radio === 'on' && connected.length > 0, sw: b && b.radio === 'on',
      sub: un('bt') ? 'Unavailable' : !b ? 'Loading…' : b.radio === 'error' ? 'Windows error' : b.radio === 'unsupported' ? 'Not available' : b.radio === 'off' || b.radio === 'disabled' ? 'Off' : connected.length ? (connected.length === 1 ? connected[0].name : connected.length + ' connected') : 'On' });
    // VPN (Proton VPN: observed, not controlled)
    setTile('vpn', { title: 'VPN', ic: v && v.connected ? 'vpn' : 'vpnOff', on: v && v.connected,
      sub: un('net') ? 'Unavailable' : !v ? 'Loading…' : !v.installed ? 'Proton VPN not installed' : v.connected ? 'Proton VPN · Connected' : 'Proton VPN · Off' });
    // Battery
    setTile('battery', { title: 'Battery', ic: bat && bat.charging ? 'batteryCharge' : 'battery', on: bat && bat.charging, sub: un('power') ? 'Unavailable' : !bat ? 'Loading…' : batText(bat) });
    // bottom row (each can be hidden in Settings)
    $('#ccBot', over).replaceChildren(...[
      S.ccMic !== false && 'mic', S.ccPower !== false && 'power', S.ccNight !== false && 'night', S.ccDisplay !== false && 'display', S.ccCharging !== false && 'charging',
    ].filter(Boolean).map((id) => $(`.tile[data-pane="${id}"]`, over) || tile(id, { mic: 'mic', power: 'gauge', night: 'moon', display: 'display', charging: 'plug' }[id], id === 'mic')));
    setTile('mic', { title: 'Microphone', ic: m && m.muted ? 'micOff' : 'mic', dim: !m || !m.present, on: m && m.present && !m.muted, sw: m && m.present && !m.muted,
      sub: !m ? 'Loading…' : !m.present ? 'No microphone' : m.muted ? 'Muted' : m.name });
    setTile('power', { title: 'Power mode', ic: 'gauge', dim: !pm || !pm.supported, sub: !pm ? 'Loading…' : !pm.supported ? 'Needs Windows 11' : (MODES.find((x) => x[0] === pm.mode) || [, 'Custom'])[1] });
    setTile('night', { title: 'Night Light', ic: 'moon', sub: 'Open Settings' });
    const prim = d && (d.find((x) => x.primary) || d[0]);
    setTile('display', { title: 'Display', sub: !prim ? '' : `${prim.w}×${prim.h}${prim.hz ? ' · ' + prim.hz + ' Hz' : ''}${d.length > 1 ? ' · ' + d.length + ' displays' : ''}` });
    setTile('charging', { title: 'Charging', ic: 'plug', on: bat && bat.hasBattery && bat.charging, dim: !bat || !bat.hasBattery,
      sub: !bat ? '' : !bat.hasBattery ? 'No battery' : bat.charging ? 'Charging' : bat.ac ? 'Plugged in, not charging' : 'Charger not connected' });
    // sliders (not while the user is dragging one)
    if (a && a.available !== false) {
      if (!dragging) { const r = $('#ccVol', over); r.value = a.muted ? 0 : a.volume; r.style.setProperty('--p', r.value + '%'); }
      $('#ccVolN', over).textContent = a.muted ? 'Muted' : a.volume;
      $('.cc-ib[data-act="mute"]', over).innerHTML = icon(volIcon(a.volume, a.muted));
      $('#ccOutN', over).textContent = a.outName || 'No output device'; $('#ccOutI', over).innerHTML = icon(outIcon(a.outName, (a.outputs.find((o) => o.default) || {}).form));
    } else { $('#ccOutN', over).textContent = un('audio') ? 'Unavailable' : 'Loading…'; $('.cc-ib[data-act="mute"]', over).innerHTML = icon('vol1'); $('#ccOutI', over).innerHTML = icon('speaker'); }
    const hasBri = st.bri !== null && st.bri !== undefined;
    const briBad = !hasBri && !!st.briError;                                        // Windows failed to read it: say so. No controller at all (desktop / external monitor): stay hidden
    $('#ccBriRow', over).hidden = !hasBri && !briBad;
    $('#ccBri', over).disabled = briBad; $('#ccBriN', over).textContent = briBad ? 'Error' : $('#ccBriN', over).textContent; $('#ccBriRow', over).title = briBad ? st.briError : '';
    if (hasBri && !dragging) { const r = $('#ccBri', over); r.value = st.bri; r.style.setProperty('--p', st.bri + '%'); $('#ccBriN', over).textContent = st.bri; }
  }

  function onOverviewClick(e) {
    const sw = e.target.closest('[data-toggle]');
    if (sw) {
      const k = sw.dataset.toggle;
      if (k === 'wifi') toggleRadio('wifi', !(st.wifi && st.wifi.radio === 'on'));
      else if (k === 'bt') toggleRadio('bt', !(st.bt && st.bt.radio === 'on'));
      else if (k === 'mic') call('mic.setMute', { muted: !(st.mic && st.mic.muted) });
      return;
    }
    if (e.target.closest('[data-act="mute"]')) { call('audio.setMute', { muted: !(st.audio && st.audio.muted) }); return; }
    const open = e.target.closest('[data-open]');
    if (open) go(open.dataset.open);
  }
  async function toggleRadio(kind, on) {
    ui.busy[kind + 'radio'] = true; paint();
    const r = await call(kind + '.setPower', { on }, { quiet: true });   // success means the backend re-read Windows and saw the new state
    ui.busy[kind + 'radio'] = false;
    if (!r.ok) { if (r.action && ui.pane !== kind) go(kind); fail(kind, r); LI.toast(r.error || 'That did not work', true); }
    paint(true);
  }

  /* ================= detail panes ================= */
  const TITLES = { wifi: ['Wi-Fi', 'wifi'], bt: ['Bluetooth', 'bluetooth'], vpn: ['VPN', 'vpn'], battery: ['Battery', 'battery'], charging: ['Charging', 'plug'], audio: ['Sound output', 'speaker'],
    mic: ['Microphone', 'mic'], power: ['Power mode', 'gauge'], night: ['Night Light', 'moon'], display: ['Displays', 'display'] };
  function go(pane) {
    if (ui.pane === 'bt' && pane !== 'bt' && ui.btScanning) call('bt.stopScan', {}, { quiet: true });
    ui.pane = pane || null; ui.picked = null; ui.pwd = ''; ui.err = {}; ui.act = {};
    const [t, ic] = pane ? TITLES[pane] : ['Control Centre', 'control'];
    LI.workspace.ccPane(pane || null, t, ic);
    paint(true);
    if (pane === 'wifi') scanWifi();
    if (pane === 'bt' && st.bt && st.bt.radio === 'on') scanBt();
  }
  function back() { if (!ui.pane) return false; go(null); return true; }
  function leave() { if (ui.btScanning) call('bt.stopScan', {}, { quiet: true }); ui.pane = null; }

  const row = (ic, title, sub, ...right) => el('div', { class: 'li-row' }, el('span', { class: 'r-ico', html: icon(ic) }), el('span', { class: 'r-txt' }, el('b', { text: title }), sub ? el('small', { text: sub }) : null), ...right);
  const btn = (text, cls, fn, dis) => { const b = el('button', { class: 'btn ' + (cls || ''), text }); if (dis) b.disabled = true; b.addEventListener('click', fn); return b; };
  const note = (t, cls) => el('p', { class: 'cc-note ' + (cls || ''), text: t });
  const sw = (on, fn, dis) => { const s = el('button', { class: 't-sw' + (on ? ' on' : ''), role: 'switch', 'aria-checked': String(!!on) }, el('i')); s.disabled = !!dis; s.addEventListener('click', fn); return s; };
  // four small bars, filled according to signal quality (0-100), plus the number for screen readers
  const bars = (q) => el('span', { class: 'sig', title: (q || 0) + '%', role: 'img', 'aria-label': 'Signal ' + (q || 0) + ' percent' },
    ...[1, 2, 3, 4].map((i) => el('i', { class: (q || 0) > (i - 1) * 25 + 5 ? 'on' : '' })));

  function wifiPane() {
    const w = st.wifi, p = el('div', { class: 'pane' });
    if (unavailable('net')) return [note(unavailable('net').message || 'Wi-Fi is not available here.')];
    if (!w) return [note('Loading…')];
    if (w.state === 'none' && w.radio === 'error') return [note('Windows could not report the Wi-Fi radio: ' + (w.radioError || 'unknown error'), 'bad')];
    if (w.state === 'none') return [note('No Wi-Fi adapter was found on this PC.')];
    p.append(row('wifi', 'Wi-Fi', w.radio === 'off' ? 'Off' : w.state === 'connected' ? 'Connected' + (w.ssid ? ' to ' + w.ssid : '') : w.state === 'connecting' ? 'Connecting…' : 'Not connected',
      ...(w.state === 'connected' ? [btn('Disconnect', 'sm', async () => { await call('wifi.disconnect'); })] : []),
      sw(w.radio === 'on', () => toggleRadio('wifi', w.radio !== 'on'), ui.busy.wifiradio || w.radio === 'unsupported')));
    if (ui.err.wifi && w.radio !== 'on') p.append(errNote('wifi'));
    if (w.radio === 'error') return [p, note('Windows could not report the Wi-Fi radio: ' + (w.radioError || 'unknown error'), 'bad')];
    if (w.radio === 'off' || w.radio === 'disabled') return [p, note(w.hardwareOff ? 'Wi-Fi is switched off by a hardware switch or key on this PC.' : 'Wi-Fi is turned off.')];
    if (w.state === 'connected' && w.ssidError === 'location_denied' && !w.ssid) p.append(el('div', { class: 'cc-errbox' }, note('Windows hides the network name from desktop apps until location access is allowed.'), btn(LOCATION.label, 'sm', () => call(LOCATION.op, { page: LOCATION.page }, { quiet: true }))));
    const head = el('div', { class: 'cc-sec' }, el('span', { text: 'Available networks' }), btn(ui.scanning ? 'Scanning…' : 'Scan', 'sm', () => scanWifi(), ui.scanning));
    const list = el('div', { class: 'cc-list' });
    if (ui.limited) list.append(el('div', { class: 'cc-errbox' }, note('Windows is blocking Wi-Fi scanning for desktop apps, so only your saved networks are listed.'), ...(ui.limited.action ? [btn(ui.limited.action.label, 'sm', () => call(ui.limited.action.op, { page: ui.limited.action.page }, { quiet: true }))] : [])));
    if (ui.err.wifi) list.append(errNote('wifi'));
    (ui.nets || []).forEach((n) => {
      const picked = ui.picked === n.ssid, connecting = ui.busy.wifi === n.ssid || (n.connected && w.state === 'connecting');
      const status = n.connected ? 'Connected' : connecting ? 'Connecting…' : n.known ? 'Saved' : n.security === 'enterprise' ? 'Needs a work account' : n.secure ? 'Secured' : 'Open';
      const r = row(n.secure ? 'lock' : 'wifi', n.ssid, status, bars(n.signal));
      r.classList.toggle('on', n.connected); r.tabIndex = 0;
      const act = () => {
        if (n.connected || connecting) return;
        if (n.security === 'enterprise' && !n.known) { ui.picked = null; ui.err.wifi = 'This network needs a work or school account. Connect to it from Windows settings.'; ui.act.wifi = null; return paint(true); }
        if (n.security === 'wep' && !n.known) { ui.picked = null; ui.err.wifi = 'This network uses WEP, which Liquid Island does not set up. Connect to it from Windows settings.'; ui.act.wifi = null; return paint(true); }
        if (n.secure && !n.known) { ui.picked = picked ? null : n.ssid; ui.pwd = ''; ui.err.wifi = ''; return paint(true); }
        connectWifi(n);
      };
      r.addEventListener('click', act); r.addEventListener('keydown', (e) => { if (e.key === 'Enter') act(); });
      list.append(r);
      if (picked) list.append(passwordForm(n));
    });
    if (!ui.nets) list.append(note('Looking for networks…')); else if (!ui.nets.length) list.append(note('No networks found.'));
    return [p, head, list];
  }
  function passwordForm(n) {
    const input = el('input', { type: 'password', class: 'input', placeholder: 'Network password', autocomplete: 'off', spellcheck: 'false', 'aria-label': 'Network password' });
    input.value = ui.pwd; input.addEventListener('input', () => { ui.pwd = input.value; go_.disabled = input.value.length < 8; });
    const go_ = btn('Connect', 'primary', () => connectWifi(n, input.value), ui.pwd.length < 8);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && input.value.length >= 8) connectWifi(n, input.value); if (e.key === 'Escape') { e.stopPropagation(); ui.picked = null; paint(true); } });
    const show = btn('Show', 'sm', () => { input.type = input.type === 'password' ? 'text' : 'password'; show.textContent = input.type === 'password' ? 'Show' : 'Hide'; });
    setTimeout(() => input.focus(), 30);
    return el('div', { class: 'pw-form' }, input, show, go_, el('small', { class: 'faint', text: 'The password goes straight to Windows. Liquid Island does not store it.' }));
  }
  async function connectWifi(n, password) {
    ui.err.wifi = ''; ui.busy.wifi = n.ssid; ui.picked = null; ui.pwd = ''; paint(true);   // user action: repaint even though the password field has focus
    const r = await call('wifi.connect', { ssid: n.ssid, security: n.security, known: !!n.known, profile: n.known && n.profile ? n.profile : '', password: password || '' }, { quiet: true });
    if (!r.ok) { ui.busy.wifi = null; fail('wifi', r); }
    paint(true); setTimeout(() => scanWifi(true), 1500);
  }
  async function scanWifi(silent) {
    if (ui.scanning || (st.wifi && st.wifi.radio !== 'on')) return;
    ui.scanning = true; if (!silent) paint();
    const r = await call('wifi.scan', {}, { quiet: true });
    ui.scanning = false;
    if (r.ok) { ui.nets = r.data.networks || []; ui.limited = r.data.limited ? { action: r.data.action || LOCATION } : null; } else { ui.nets = ui.nets || []; fail('wifi', r); }
    if (ui.pane === 'wifi') paint();
  }

  async function scanBt() { ui.found = []; ui.btScanning = true; paint(); const r = await call('bt.scan', {}, { quiet: true }); if (!r.ok) { ui.btScanning = false; fail('bt', r); paint(); } }
  function btPane() {
    const b = st.bt;
    if (unavailable('bt')) return [note(unavailable('bt').message || 'Bluetooth is not available here.')];
    if (!b) return [note('Loading…')];
    if (b.radio === 'unsupported') return [note('Windows lists no Bluetooth radio on this PC.')];
    if (b.radio === 'error') return [note('Windows could not report the Bluetooth radio: ' + (b.radioError || 'unknown error'), 'bad')];
    const out = [row('bluetooth', 'Bluetooth', b.radio === 'on' ? 'On' : 'Off', sw(b.radio === 'on', () => toggleRadio('bt', b.radio !== 'on'), ui.busy.btradio))];
    if (ui.err.bt && b.radio !== 'on') out.push(errNote('bt'));
    if (b.radio !== 'on') return [...out, note('Bluetooth is turned off.')];
    if (ui.err.bt) out.push(errNote('bt'));
    out.push(el('div', { class: 'cc-sec' }, el('span', { text: 'My devices' })));
    const mine = el('div', { class: 'cc-list' });
    if (!b.devices.length) mine.append(note('No paired devices. Use Add a device below.'));
    b.devices.forEach((d) => {
      const busy = ui.busy['bt:' + d.id];
      mine.append(row(KIND_ICON[d.kind] || 'bluetooth', d.name, busy ? busy + '…' : d.connected ? 'Connected' : 'Paired',
        d.le ? el('small', { class: 'faint', text: 'Auto' }) : btn(d.connected ? 'Disconnect' : 'Connect', 'sm', () => btAction(d, d.connected ? 'disconnect' : 'connect'), !!busy)));
    });
    out.push(mine, el('div', { class: 'cc-sec' }, el('span', { text: 'Add a device' }), btn(ui.btScanning ? 'Searching…' : 'Search', 'sm', scanBt, ui.btScanning)));
    const near = el('div', { class: 'cc-list' });
    const paired = new Set(b.devices.map((d) => d.id));
    ui.found.filter((d) => !paired.has(d.id)).forEach((d) => { const busy = ui.busy['bt:' + d.id]; near.append(row('bluetooth', d.name, busy ? busy + '…' : d.le ? 'Available · low energy' : 'Available', btn('Pair', 'sm', () => btAction(d, 'pair'), !!busy))); });
    if (!near.children.length) near.append(note(ui.btScanning ? 'Looking for devices. Put yours in pairing mode.' : 'Nothing found yet.'));
    out.push(near);
    return out;
  }
  async function btAction(d, what) {
    ui.err.bt = ''; ui.busy['bt:' + d.id] = { connect: 'Connecting', disconnect: 'Disconnecting', pair: 'Pairing' }[what]; paint();
    const r = await call('bt.' + what, { id: d.id }, { quiet: true });          // success is only known once Windows confirms it (state event)
    ui.busy['bt:' + d.id] = null; if (!r.ok) fail('bt', r); paint();
  }

  function vpnPane() {
    const v = st.vpn;
    if (unavailable('net')) return [note(unavailable('net').message || 'Not available here.')];
    if (!v) return [note('Loading…')];
    const out = [];
    if (!v.installed) out.push(row('vpnOff', 'Proton VPN', 'Not installed on this PC'), note('Install the Proton VPN app from protonvpn.com, then come back here to see its status.'));
    else out.push(row(v.connected ? 'vpn' : 'vpnOff', 'Proton VPN', v.connected ? 'Connected (tunnel adapter up with an address)' : v.connecting ? 'Connecting…' : v.running ? 'Not connected' : 'Not running'),
      row('rocket', 'Status source', 'Windows network adapter state. Server and location are private to the Proton app.'),
      el('div', { class: 'cc-actions' }, btn(v.running ? 'Open Proton VPN' : 'Start Proton VPN', 'primary', async () => { const r = await call('vpn.openApp'); if (r.ok) LI.toast('Opening Proton VPN'); })));
    out.push(note('Liquid Island shows whether Proton VPN is connected, but cannot connect or disconnect it: Proton publishes no control interface for Windows, and this app will not automate its login or read its data.'));
    return out;
  }
  function batteryPane() {
    const b = st.battery;
    if (unavailable('power')) return [note(unavailable('power').message || 'Not available here.')];
    if (!b) return [note('Loading…')];
    const out = [];
    if (!b.hasBattery) out.push(row('plug', 'No battery', 'This PC runs on mains power.'));
    else out.push(el('div', { class: 'bat-big' }, el('b', { text: b.percent != null ? b.percent + '%' : '–' }), el('span', { text: b.charging ? 'Charging' : b.ac ? 'Plugged in, not charging' : 'On battery' }),
      el('div', { class: 'bat-bar' }, el('i', { style: `width:${b.percent || 0}%` }))));
    out.push(row('plug', 'Power source', b.ac == null ? 'Unknown' : b.ac ? 'Charger connected' : 'Charger not connected'));
    if (b.hasBattery) {
      out.push(row('timer', 'Time remaining', b.charging || b.ac ? 'Not applicable while plugged in' : b.minutes != null ? fmtMin(b.minutes) : 'Windows is still estimating'));
      out.push(row('leaf', 'Battery saver', b.saver ? 'On' : 'Off'));
    }
    return out;
  }
  function audioPane() {
    const a = st.audio;
    if (unavailable('audio')) return [note(unavailable('audio').message || 'Not available here.')];
    if (!a || a.available === false) return [note(a ? 'No sound output device was found.' : 'Loading…')];
    const out = el('div', { class: 'cc-list' });
    a.outputs.forEach((o) => {
      const r = row(outIcon(o.name, o.form), o.name, o.default ? 'Default output' : '', o.default ? el('span', { class: 'chk', html: icon('check') }) : null);
      r.classList.toggle('on', o.default); r.tabIndex = 0;
      const pick = async () => { if (o.default) return; const x = await call('audio.setOutput', { id: o.id }); if (x.ok) LI.toast('Switched to ' + o.name); };
      r.addEventListener('click', pick); r.addEventListener('keydown', (e) => { if (e.key === 'Enter') pick(); });
      out.append(r);
    });
    return [el('div', { class: 'cc-sec' }, el('span', { text: 'Choose where sound plays' })), out, note('Volume ' + (a.muted ? 'is muted' : a.volume + '%') + '. Use the slider on the overview to change it.')];
  }
  function micPane() {
    const m = st.mic;
    if (unavailable('audio')) return [note(unavailable('audio').message || 'Not available here.')];
    if (!m || !m.present) return [note(m ? 'No microphone was found.' : 'Loading…')];
    return [row(m.muted ? 'micOff' : 'mic', m.name, m.muted ? 'Muted' : 'On', sw(!m.muted, () => call('mic.setMute', { muted: !m.muted }))),
      note('Liquid Island only reads the microphone’s mute switch. It never listens to or records audio.')];
  }
  function powerPane() {
    const pm = st.powermode;
    if (unavailable('power')) return [note(unavailable('power').message || 'Not available here.')];
    if (!pm || !pm.supported) return [note(pm ? 'Power modes need Windows 11 on a supported device.' : 'Loading…')];
    const list = el('div', { class: 'cc-list' });
    MODES.forEach(([id, name, ic]) => {
      const r = row(ic, name, id === pm.mode ? 'Current' : '', id === pm.mode ? el('span', { class: 'chk', html: icon('check') }) : null); r.classList.toggle('on', id === pm.mode); r.tabIndex = 0;
      const pick = async () => { if (id === pm.mode) return; const x = await call('power.setMode', { mode: id }); if (x.ok) LI.toast(name); };
      r.addEventListener('click', pick); r.addEventListener('keydown', (e) => { if (e.key === 'Enter') pick(); });
      list.append(r);
    });
    return [list, note(`Applies to ${pm.source === 'ac' ? 'plugged in' : 'on battery'} use. If a mode is not available on this PC, Windows refuses it and you will see that here.`)];
  }
  function nightPane() {
    return [row('moon', 'Night Light', 'Status not available to apps'),
      note('Windows has no supported way for an app to read or switch Night Light, and Liquid Island does not use undocumented registry hacks. Windows Settings opens its own Night Light page.'),
      el('div', { class: 'cc-actions' }, btn('Open Windows Settings', 'primary', () => call('night.openSettings')))];
  }
  function displayPane() {
    const d = st.displays || [];
    const out = d.map((x) => row('display', x.label + (x.primary ? ' (primary)' : ''), `${x.w}×${x.h} · ${x.hz || '?'} Hz · ${x.scale}% scale${x.rotation ? ' · rotated ' + x.rotation + '°' : ''}`));
    return [...out, note('This list is read-only. Brightness is on the overview for displays that support it.'), el('div', { class: 'cc-actions' }, btn('Open display settings', '', () => call('display.openSettings')))];
  }
  const PANES = { wifi: wifiPane, bt: btPane, vpn: vpnPane, battery: batteryPane, charging: batteryPane, audio: audioPane, mic: micPane, power: powerPane, night: nightPane, display: displayPane };

  /* ================= paint / mount ================= */
  function paint(force) {
    if (!root || LI.workspace.route().type !== 'cc') return;
    if (!ui.pane) { if (!body.hidden || force) { body.hidden = true; over.hidden = false; } paintOverview(); return; }
    over.hidden = true; body.hidden = false;
    const a = document.activeElement;
    if (!force && body.contains(a) && a.tagName === 'INPUT') return;           // never rebuild under a field the user is typing in
    body.replaceChildren(...(PANES[ui.pane]() || []).filter(Boolean));
    if (force && !LI.reduceMotion()) { body.classList.remove('enter'); void body.offsetWidth; body.classList.add('enter'); }
  }
  function mount(host, pane) {
    if (!root) {
      root = host; buildOverview(); body = el('div', { class: 'cc-pane', hidden: true });
      root.replaceChildren(over, body);
    }
    ui.pane = null; load();
    if (pane) go(pane); else { LI.workspace.ccPane(null, 'Control Centre', 'control'); paint(true); }
  }

  LI.cc = { mount, go, back, leave, state: st };
})();
