'use strict';

// Presentation durations only. Processing uses the real job progress; these
// event receipts never advance a job, release inventory, or award currency.
const ART_EFFECTS = Object.freeze({
  installation: Object.freeze({ duration: 2, radiusRatio: .37, particles: 3 }),
  delivery: Object.freeze({ duration: .65, cooldown: .75 }),
  processing: Object.freeze({ steamOpacity: .3, sparkleOpacity: .6 })
});

module.exports = { ART_EFFECTS };
