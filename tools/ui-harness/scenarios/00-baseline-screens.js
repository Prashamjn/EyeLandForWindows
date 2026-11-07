module.exports = async (c) => {
  await c.shot('base_idle');
  c.send('system', { kind: 'vol', value: 40, muted: false }); await c.wait(300);
  c.send('system', { kind: 'vol', value: 62, muted: false }); await c.wait(700);
  await c.shot('base_overlay');
  await c.ev("openPanel()"); await c.wait(900);
  await c.shot('base_panel');
};
