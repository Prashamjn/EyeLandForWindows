module.exports = async (c) => {
  await c.wait(800);
  await c.shot('01_compact');
  c.send('system', { kind: 'vol', value: 40, muted: false }); await c.wait(300);   // first reading: must NOT pop
  const st0 = await c.ev("LI.island.state"); c.log('state after first vol reading (expect compact):', st0);
  c.send('system', { kind: 'vol', value: 62, muted: false }); await c.wait(900);
  await c.shot('02_mini_volume');
  c.send('toast', { icon: 'copy', text: 'Copied 128 characters' }); await c.wait(900);
  await c.shot('03_mini_notice');
  c.send('media', { title: 'Midnight City', artist: 'M83', app: 'Spotify', playing: true }); await c.wait(300);
  c.send('media', { title: 'Intro', artist: 'The xx', app: 'Spotify', playing: true }); await c.wait(900);
  await c.shot('04_mini_media');
  await c.wait(3600);
  c.log('state after mini timeout (expect compact):', await c.ev("LI.island.state"));
  await c.ev("LI.island.open()"); await c.wait(1100);
  await c.shot('05_full_home');
};
