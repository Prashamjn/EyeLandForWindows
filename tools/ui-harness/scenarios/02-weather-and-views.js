// Weather success path uses a FIXTURE injected at the IPC layer (sandbox has no internet). Labelled as such in the report.
const fixture = { current: { temperature_2m: 31.4, weather_code: 2, is_day: 1 }, daily: { temperature_2m_max: [34.2], temperature_2m_min: [22.8] } };
module.exports = async (c) => {
  const { ipcMain } = c;
  ipcMain.removeHandler('ey:ip-location'); ipcMain.removeHandler('ey:fetch-json');
  let calls = 0, failNext = true;
  ipcMain.handle('ey:ip-location', () => ({ name: 'Kota, India', lat: 25.18, lon: 75.83 }));
  ipcMain.handle('ey:fetch-json', (_e, url) => { calls++; c.log('fetch-json url:', url); if (failNext) throw new Error('fixture: offline'); return fixture; });
  await c.wait(600);
  await c.ev("LI.island.open()"); await c.wait(1000);
  await c.shot('10_weather_network_error');
  failNext = false;
  await c.ev("document.getElementById('wxRetry').click()"); await c.wait(500);
  await c.shot('11_weather_ok');
  // views
  for (const v of ['plugins', 'timer', 'clips', 'tasks', 'settings']) { await c.ev(`LI.dashboard.show('${v}')`); await c.wait(350); await c.shot('12_view_' + v); }
  c.log('fetch-json calls:', calls);
};
