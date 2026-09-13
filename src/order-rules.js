'use strict';
const { CONFIG } = require('./factory-rules');

// Original-only commerce tuning. Production timings and artwork generations
// remain shared with the existing factory; prices belong to this economy.
const ORDER_RULES = {
  capacity: 24, deliveryBatch: 4, maxOrders: 2, targetStock: 24,
  templates: [{ amount: 4, quote: 4 }, { amount: 6, quote: 7 },
    { amount: 8, quote: 10 }, { amount: 4, quote: 5 }],
  salesperson: { cost: 12, serviceTicks: 240, batch: 4 },
  assist: { intervalTicks: 30, windowTicks: 120, maxExtraTicks: 48, progressTicks: 12, maxSpeedMultiplier: 1.4 },
  automation: {
    pop: { ...CONFIG.automation.routes.pop, cost: 4 },
    cup: { ...CONFIG.automation.routes.cup, cost: 7 }
  },
  upgradeCosts: { pop: [0, 18, 55, 160, 420, 1200, 3400],
    cup: [0, 12, 28, 50, 70, 180, 450, 1300, 3600],
    ship: [0, 20, 50, 140, 400, 1100, 3000] },
  logisticsLevels: CONFIG.automation.logisticsLevels.map((level, index) => ({ ...level,
    cost: [0, 16, 55, 180][index], finishedCapacity: [24, 36, 48, 72][index], targetStock: [24, 36, 48, 72][index] })),
  machines: CONFIG.automation.machines.map((machine, index) => ({ ...machine,
    cost: [0, 80, 300, 900, 2600, 7500][index], requiredSold: [0, 80, 280, 800, 2300, 6600][index],
    description: index ? '通过真实订单收入扩建，开放更多设备能力' : machine.description }))
};
ORDER_RULES.stations = Object.fromEntries(['fresh', 'legacy'].map(profile => [profile,
  Object.fromEntries(CONFIG.stationIds.map(id => [id, {
    ...(profile === 'fresh' ? CONFIG.automation.stations : CONFIG.stations)[id],
    levels: (profile === 'fresh' ? CONFIG.automation.stations : CONFIG.stations)[id].levels.map((level, index) =>
      ({ ...level, cost: ORDER_RULES.upgradeCosts[id][index] }))
  }]))]));
function freeze(value) {
  for (const child of Object.values(value)) if (child && typeof child === 'object') freeze(child);
  return Object.freeze(value);
}
freeze(ORDER_RULES);
module.exports = { ORDER_RULES };
