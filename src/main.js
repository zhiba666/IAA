'use strict';
const { createPlatform } = require('./platform');
const { MODE } = require('./v13-order-mode');
const { loadOrderSession } = require('./order-session');

const platform = createPlatform();
if (platform.config.mode === MODE) {
  const session = loadOrderSession(platform);
  if (session.compatibility) {
    require('./legacy-main').startLegacyGame(platform, session.legacySave, session.message);
  } else require('./main-v13-orders').startOrderGame({ platform, session });
} else require('./legacy-main').startLegacyGame(platform);
