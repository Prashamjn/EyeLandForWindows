// Display information from Electron's screen module (no native helper needed). Read-only: we make no claim of controlling monitors.
const { screen } = require('electron');
const label = (d, i) => (d.label && !/^\\\\\.\\DISPLAY/i.test(d.label) ? d.label : `Display ${i + 1}`);
function snapshot() {
  const primary = screen.getPrimaryDisplay().id;
  return screen.getAllDisplays().map((d, i) => ({
    id: d.id, label: label(d, i), primary: d.id === primary, internal: !!d.internal,
    w: Math.round(d.size.width * d.scaleFactor), h: Math.round(d.size.height * d.scaleFactor),   // physical pixels
    scale: Math.round(d.scaleFactor * 100), hz: d.displayFrequency || 0, rotation: d.rotation || 0,
  }));
}
module.exports = { snapshot };
