'use strict';
const { CONFIG } = require('./core');

// Presentation only: the live game remains the authority for accepting attempts.
function selectHeatGuide(view = {}) {
  const timing = view.timing || {};
  const rawEnergy = typeof view.energy === 'number' && Number.isFinite(view.energy) ? view.energy : 0;
  const energy = Math.max(0, Math.min(CONFIG.energyMax, rawEnergy));
  const window = `${CONFIG.timingWindowStart}–${CONFIG.timingWindowEnd}`;
  const bonus = `+${CONFIG.timingBonusPercent}%`;
  let state, title, hint, buttonLabel;

  if (!timing.unlocked) {
    state = 'locked'; title = '蓄满自动爆锅';
    hint = '首次爆锅后解锁火候挑战'; buttonLabel = '自动爆锅';
  } else if (timing.armed) {
    state = 'armed'; title = `火候正好 · 本锅 ${bonus}`;
    hint = '蓄满后自动结算额外产量'; buttonLabel = '已锁定加成';
  } else if (timing.attempted) {
    state = 'missed'; title = '继续蓄满，照常爆锅';
    hint = '本锅已尝试 · 下锅再挑战'; buttonLabel = '本锅已尝试';
  } else if (energy < CONFIG.timingAttemptEnergy) {
    state = 'heating'; title = '正在升温';
    hint = `${Math.ceil(CONFIG.timingAttemptEnergy - energy)} 格后可点火 · ${window} 最佳`;
    buttonLabel = '等待升温';
  } else if (energy < CONFIG.timingWindowStart) {
    state = 'ready'; title = '快到最佳火候';
    hint = `${window} 点火，本锅额外 ${bonus}`; buttonLabel = '尝试点火';
  } else if (energy <= CONFIG.timingWindowEnd) {
    state = 'perfect'; title = '最佳火候 · 现在点火';
    hint = `抓准火候，本锅额外 ${bonus}`; buttonLabel = '现在点火';
  } else {
    state = 'late'; title = '已过最佳火候';
    hint = '本锅仍会照常免费爆锅'; buttonLabel = '尝试点火';
  }

  return {
    state, title, hint, buttonLabel,
    canAttempt: !!(timing.available && timing.unlocked && !timing.attempted && !timing.armed),
    energy, progress: energy / CONFIG.energyMax,
    windowStart: CONFIG.timingWindowStart / CONFIG.energyMax,
    windowEnd: CONFIG.timingWindowEnd / CONFIG.energyMax
  };
}

function selectRecoveryLesson(view = {}) {
  const recovery = view.milestones && view.milestones.heatRecovery;
  const learning = view.state && view.state.learning || {};
  if (!recovery || !recovery.unlocked || learning.heatRecoveryDismissed || learning.heatRecoveryUses >= 10) return null;
  const uses = Math.max(0, Math.min(10, Number(learning.heatRecoveryUses) || 0));
  const charged = recovery.remainingTaps > 0;
  return {
    id: 'learning:heat-recovery', source: 'learning', ready: false, action: 'heatLesson',
    title: charged ? '用余热，让下一锅更快' : '新本领：余热接力',
    text: charged ? '已练习 ' + uses + '/10 次 · 每次额外 +1 能量' : '92–98点火，完美爆锅后获得10次余热',
    uses, charged
  };
}

module.exports = { selectHeatGuide, selectRecoveryLesson };
