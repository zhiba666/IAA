'use strict';

// Presentation durations only. Processing uses the real job progress; these
// event receipts never advance a job, release inventory, or award currency.
const ART_EFFECTS = Object.freeze({
  installation: Object.freeze({ duration: 2, radiusRatio: .37, particles: 3 }),
  delivery: Object.freeze({ duration: .65, cooldown: .75 }),
  transfer: Object.freeze({ pickupDuration: .1, duration: .2, ghostOffset: 24, targetTolerance: 12 }),
  tutorial: Object.freeze({ handSize: 36, fingertip: [17 / 128, 9 / 128] }),
  processing: Object.freeze({ steamOpacity: .3, sparkleOpacity: .6 })
});

module.exports = { ART_EFFECTS };
