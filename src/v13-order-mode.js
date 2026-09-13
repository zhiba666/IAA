'use strict';

const MODE = 'factory-orders';
const SAVE_VERSION = 2;
const SAVE_KEY = 'little_popcorn_factory_orders_v2';
const LEGACY_MODE = 'v13-orders-p0';
const LEGACY_SAVE_VERSION = 1;
const LEGACY_SAVE_KEY = 'little_popcorn_factory_orders_p0_v1';

function requestedMode(root, win, isDouyin) {
  const config = root && root.POPCORN_CONFIG || {};
  const search = !isDouyin && win && win.location ? win.location.search || '' : '';
  const match = /(?:^\?|&)mode=([^&]*)(?:&|$)/.exec(search);
  return match ? match[1] : config.mode;
}

// Former prototype and deployment defaults share the complete main game.
// Only explicit compatibility routes start the historical factory.
function wantsV13Orders(root, win, isDouyin) {
  return !['baseline', 'legacy-v15'].includes(requestedMode(root, win, isDouyin));
}

module.exports = { MODE, SAVE_VERSION, SAVE_KEY, LEGACY_MODE, LEGACY_SAVE_VERSION,
  LEGACY_SAVE_KEY, requestedMode, wantsV13Orders };
