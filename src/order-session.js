'use strict';
const { Game, CONFIG } = require('./core');
const { V13OrderGame, migrateLegacySave } = require('./v13-order-core');
const { MODE, SAVE_VERSION } = require('./v13-order-mode');

function loadOrderSession(platform, now = Date.now()) {
  const raw = platform.load(), storageError = platform.lastStorageError;
  const blocked = message => ({ game: new V13OrderGame({ now }), recoveryBlocked: true, message });
  if (storageError) return blocked('存档读取失败，经营已暂停。原数据保留，请重试读取。');
  if (!raw) return { game: new V13OrderGame({ now }), recoveryBlocked: false, message: '' };
  const current = raw.mode === MODE && raw.version === SAVE_VERSION;
  const legacyFactory = raw.version === CONFIG.version || raw.version === CONFIG.automation.version;
  const fallback = reason => {
    if (legacyFactory) {
      const valid = new Game({ save: raw, now, mode: raw.version === CONFIG.automation.version ? 'v15' : null });
      if (!valid.loadWarning && typeof platform.useLegacy === 'function') {
        platform.useLegacy(raw.version);
        return { compatibility: true, legacySave: raw, recoveryBlocked: false,
          message: '双场景接续未完成（' + reason + '），已继续原工厂；原等级、账目与能力保留。' };
      }
    }
    return blocked('存档接续未完成（' + reason + '），经营已暂停，原数据保留。可重试读取；旧正式档可由兼容入口继续。');
  };
  let candidate = raw;
  if (legacyFactory) {
    const result = migrateLegacySave(raw, now);
    if (!result.ok) return fallback(result.reason);
    candidate = result.save;
  }
  const game = new V13OrderGame({ save: candidate, now });
  if (game.loadWarning) return fallback('格式或守恒校验失败');
  if (current) return { game, recoveryBlocked: false, message: '' };
  const info = platform.saveSource;
  const validate = saved => !new V13OrderGame({ save: saved, now }).loadWarning;
  if (!platform.save(game.exportSave(now), validate)) return fallback(platform.lastStorageError || '写入或回读失败');
  const committed = platform.load();
  if (platform.lastStorageError || !committed || committed.mode !== MODE || !validate(committed)) return fallback('迁移回读失败');
  return { game: new V13OrderGame({ save: committed, now }), recoveryBlocked: false,
    message: '旧进度已备份并接续双场景，历史收入未重复卖货。' +
      (info && info.alternatives.length ? '另有旧档保留在原存储键，未覆盖。' : '') };
}
module.exports = { loadOrderSession };
