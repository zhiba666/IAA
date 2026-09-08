'use strict';
const { CONFIG } = require('./core');
function selectHeatGuide(view = {}) {
  const factory = view.factory || {};
  const energy = Number.isFinite(view.energy) ? Math.max(0,Math.min(CONFIG.energyMax,view.energy)) : 0;
  const stored = !!factory.storedBurst;
  const storesNext = factory.unlocked && factory.pressureMode === 'hold' && Array.isArray(factory.equipped) && factory.equipped.includes('pressure');
  const remaining = Math.ceil(CONFIG.energyMax - energy);
  return { state: stored ? 'stored' : 'heating',
    title: stored ? '蓄压锅已备好' : storesNext ? '蓄满自动储锅' : '蓄满自动爆锅',
    hint: stored ? '选择时机放出，普通生产仍会继续' : storesNext ? remaining + ' 格后存入蓄压罐，继续生产即可' : remaining + ' 格后自动出锅，继续生产即可',
    buttonLabel: stored ? '放出蓄压锅' : storesNext ? '自动储锅' : '自动爆锅', energy, progress: energy / CONFIG.energyMax };
}
// Residual-heat lessons are retired.
function selectRecoveryLesson() { return null; }
module.exports = { selectHeatGuide, selectRecoveryLesson };
