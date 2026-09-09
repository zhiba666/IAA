'use strict';

// Every production rate, purchase price and expansion gate lives here. A lane
// handles batchSize actual portions in cycleTicks; packaging creates no portions.
const TICKS_PER_SECOND = 120;
const spec = (name, cost, requiredMachine, lanes, batchSize, cycleTicks) => ({
  name, cost, requiredMachine, lanes, batchSize, cycleTicks,
  capacity: lanes * batchSize * TICKS_PER_SECOND / cycleTicks
});
const CONFIG = {
  version: 2,
  title: '小小爆米花厂',
  ticksPerSecond: TICKS_PER_SECOND,
  rateWindowSeconds: 10,
  price: 1,
  stationIds: ['pop', 'cup', 'ship'],
  stations: {
    pop: { name: '爆锅', levels: [
      spec('自动爆锅', 0, 0, 1, 1, 30),
      spec('均匀加热', 100, 0, 1, 1, 20),
      spec('并排双锅', 240, 1, 2, 1, 30),
      spec('双锅连续加热', 600, 2, 2, 1, 15),
      spec('四锅并行', 1500, 3, 4, 1, 15),
      spec('双份连续爆锅', 4800, 4, 4, 2, 15),
      spec('六锅供料阵列', 14000, 5, 6, 2, 15)
    ] },
    cup: { name: '装杯', levels: [
      spec('单头装杯', 0, 0, 1, 1, 60),
      spec('快速装杯头', 30, 0, 1, 1, 20),
      spec('双头装杯', 200, 1, 2, 1, 24),
      spec('双头连续装杯', 550, 2, 2, 1, 15),
      spec('三头装杯', 1400, 3, 3, 1, 15),
      spec('四头双份装杯', 4200, 4, 4, 2, 15),
      spec('六头双份装杯', 12000, 5, 6, 2, 15)
    ] },
    ship: { name: '出货', levels: [
      spec('单份出货', 0, 0, 1, 1, 20),
      spec('快速出货带', 120, 0, 1, 1, 15),
      spec('双份成组包装', 180, 1, 1, 2, 20),
      spec('双道成组包装', 450, 2, 2, 2, 24),
      spec('四份成箱出货', 1200, 3, 2, 4, 30),
      spec('四道整箱出货', 3800, 4, 4, 4, 24),
      spec('高速整箱出货', 10000, 5, 4, 4, 15)
    ] }
  },
  // The gate belongs to the destination stage and never follows current output.
  // Reaching its measured rate is remembered; a later jam cannot revoke it.
  machines: [
    { id: 0, name: '手摇锅', description: '自动开工，先疏通装杯积压', color: '#f3b35b', cost: 0, requiredSold: 0, targetRate: 0, buffers: { pop: 12, cup: 12 } },
    { id: 1, name: '电热锅', description: '扩建双锅工位，开放双头装杯与成组包装', color: '#ed785d', cost: 180, requiredSold: 100, targetRate: 3, buffers: { pop: 24, cup: 24 } },
    { id: 2, name: '双缸机', description: '让双锅持续运转，增设第二条包装通道', color: '#66bfaa', cost: 1100, requiredSold: 650, targetRate: 7, buffers: { pop: 48, cup: 48 } },
    { id: 3, name: '多头机', description: '开放四锅并行、三头装杯与四份成箱', color: '#6baacb', cost: 4200, requiredSold: 2600, targetRate: 12, buffers: { pop: 96, cup: 96 } },
    { id: 4, name: '自动流水线', description: '开放双份加工与四道整箱出货', color: '#9c86cf', cost: 12500, requiredSold: 8500, targetRate: 22, buffers: { pop: 192, cup: 192 } },
    { id: 5, name: '巨型爆米花塔', description: '扩建六头加工阵列，接通高速整箱出货', color: '#e5ad4d', cost: 38000, requiredSold: 26000, targetRate: 48, buffers: { pop: 384, cup: 384 } }
  ]
};
function freezeTree(value) {
  for (const child of Object.values(value)) if (child && typeof child === 'object') freezeTree(child);
  return Object.freeze(value);
}
freezeTree(CONFIG);
module.exports = { CONFIG };
