// Maps a native error code to the action that can fix it. The message itself always comes from Windows / the helper, never from here.
const SETTINGS = {                                  // whitelist: the renderer can only ask for these pages by key
  location: 'ms-settings:privacy-location',
  radios: 'ms-settings:privacy-radios',
  bluetooth: 'ms-settings:bluetooth',
  wifi: 'ms-settings:network-wifi',
  sound: 'ms-settings:sound',
};
const ACTIONS = {
  location_denied: { page: 'location', label: 'Open location settings' },
  radio_denied: { page: 'radios', label: 'Open radio privacy settings' },
};
const actionFor = (code) => (ACTIONS[code] ? { op: 'settings.open', page: ACTIONS[code].page, label: ACTIONS[code].label } : null);
module.exports = { SETTINGS, actionFor };
