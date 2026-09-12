'use strict';

const MODE = 'v13-orders-p0';
const SAVE_VERSION = 1;
const SAVE_KEY = 'little_popcorn_factory_orders_p0_v1';

// Resolve the opt-in before creating a canvas or reading any save key.
function wantsV13Orders(root, win, isDouyin) {
  const config = root && root.POPCORN_CONFIG || {};
  const search = !isDouyin && win && win.location ? win.location.search || '' : '';
  return config.mode === MODE || /(?:^\?|&)mode=v13-orders-p0(?:&|$)/.test(search);
}

module.exports = { MODE, SAVE_VERSION, SAVE_KEY, wantsV13Orders };
