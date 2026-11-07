const ok = (n, c, x = '') => console.log(`[TEST] ${c ? 'PASS' : 'FAIL'}  ${n}${x ? '  ' + x : ''}`);
module.exports = async (c) => {
  const { ipcMain } = c; ipcMain.removeHandler('ey:ip-location'); ipcMain.removeHandler('ey:fetch-json');
  let mode = 'net', urls = [];
  ipcMain.handle('ey:ip-location', () => ({ name: 'Kota, India', lat: 25.18, lon: 75.83 }));
  ipcMain.handle('ey:fetch-json', (_e, u) => { urls.push(u); if (mode === 'net') throw new Error('HTTP 503'); if (mode === 'bad') return { oops: true }; return { current: { temperature_2m: 88.7, weather_code: 61, is_day: 1 }, daily: { temperature_2m_max: [91], temperature_2m_min: [75] } }; });
  await c.wait(1200);                                           // boot-time load happened with the real (offline) handler
  const txt = () => c.ev("document.getElementById('weather').textContent.replace(/\\s+/g,' ').trim()");
  await c.ev("LI.dashboard.loadWeather(true); 0"); await c.wait(400);
  ok('network failure -> "Weather unavailable / Check your internet connection"', /Weather unavailable.*internet connection/.test(await txt()), await txt());
  mode = 'bad'; await c.ev("LI.dashboard.loadWeather(true); 0"); await c.wait(400);
  ok('malformed payload -> "unexpected response" (no invented data)', /unexpected response/.test(await txt()) && !/°/.test(await txt()), await txt());
  mode = 'good'; await c.ev("document.getElementById('wxRetry').click(); 0"); await c.wait(400);
  ok('retry recovers; shows Fahrenheit-less default unit C label', /Kota, India.*89.*C.*Rain/.test(await txt()), await txt());
  const before = urls.length;
  await c.ev("(() => { const s = document.getElementById('f_tempUnit'); s.value = 'f'; s.dispatchEvent(new Event('input')); })(); 0"); await c.wait(500);
  ok('switching to °F refetches with temperature_unit=fahrenheit', urls.length === before + 1 && /temperature_unit=fahrenheit/.test(urls[urls.length - 1]), urls[urls.length - 1].slice(-40));
  ok('unit label now F', /F/.test(await txt()), await txt());
};
