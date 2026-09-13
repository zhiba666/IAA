'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Game } = require('../src/core');
const { V13OrderGame } = require('../src/v13-order-core');
const { loadOrderSession } = require('../src/order-session');
const { createOrderStorage, PENDING_KEY, COMMIT_KEY } = require('../src/order-storage');
const { SAVE_KEY, LEGACY_SAVE_KEY } = require('../src/v13-order-mode');
const NOW = 1800000000000;
const FORMAL_KEY = 'little_popcorn_factory_automation_v4';
const BASELINE_KEY = 'little_popcorn_factory_pipeline_v2';

function host(storage = new Map(), fault = {}) {
  const store = createOrderStorage({
    read(key) { if (fault.readKey === key) throw new Error('read-denied'); return storage.get(key); },
    write(key, value) {
      if (key === fault.writeKey) throw new Error('write-denied');
      storage.set(key, key === fault.corruptKey ? 'corrupt' : value);
    },
    remove(key) { if (fault.noRollback) throw new Error('rollback-denied'); storage.delete(key); }
  });
  return {
    storage, lastStorageError: '', compatibilityVersion: null,
    get saveSource() { return store.info; },
    load() { this.lastStorageError = ''; try { return store.load(); } catch (error) { this.lastStorageError = error.message; return null; } },
    save(value, validate) { this.lastStorageError = ''; try { return store.save(value, validate); } catch (error) { this.lastStorageError = error.message; return false; } },
    useLegacy(version) { this.compatibilityVersion = version; }
  };
}
function oldFactory(version = 4) {
  const game = new Game({ now: NOW, mode: version === 4 ? 'v15' : null });
  for (let i = 0; i < 20; i++) {
    game.tick(4);
    if (version === 4) for (const source of ['pop', 'cup']) {
      const hold = game.reserveTransfer(source); if (hold.ok) game.commitTransfer(hold.token);
    }
  }
  if (version === 4) assert.equal(game.buyUpgrade('cup').ok, true);
  return game.exportSave(NOW);
}
function oldTrial() {
  const game = new V13OrderGame({ now: NOW });
  const save = game.exportSave(NOW);
  save.mode = 'v13-orders-p0'; save.version = 1;
  for (const key of ['baseline', 'purchases', 'salesperson', 'assists']) delete save.commerce[key];
  for (const order of save.commerce.orders) delete order.assignedTo;
  return save;
}

test('valid v2, v4 and order trial migrate via exact backup, verified write and actual core reload', () => {
  for (const [key, raw] of [[BASELINE_KEY, oldFactory(2)], [FORMAL_KEY, oldFactory()], [LEGACY_SAVE_KEY, oldTrial()]]) {
    const original = JSON.stringify(raw, null, 2), storage = new Map([[key, original]]), platform = host(storage);
    const session = loadOrderSession(platform, NOW);
    assert.equal(session.recoveryBlocked, false, session.message);
    assert.equal(session.compatibility, undefined, session.message);
    assert.match(session.message, /已备份/);
    assert.equal(storage.get(key), original);
    assert.equal(storage.get(SAVE_KEY + '_backup_' + key), original);
    const restored = loadOrderSession(host(storage), NOW);
    assert.equal(restored.recoveryBlocked, false);
    const before = raw.factory || raw;
    assert.equal(restored.game.state.coins, before.coins);
    assert.equal(restored.game.state.totalSold, before.totalSold);
    assert.equal(restored.game.state.totalEarned, before.totalEarned);
    assert.equal(restored.game.state.totalSpent, before.totalSpent);
    assert.deepEqual(restored.game.state.upgrades, before.upgrades);
    assert.equal(restored.game.getView().finished.stock.original, raw.commerce ? raw.commerce.stock.original : 0,
      'historical sales do not become new finished goods');
  }
});

test('every migration write phase and failed rollback preserve a usable formal source across restart', () => {
  const old = JSON.stringify(oldFactory()), backupKey = SAVE_KEY + '_backup_' + FORMAL_KEY;
  for (const key of [backupKey, PENDING_KEY, SAVE_KEY, COMMIT_KEY]) for (const type of ['writeKey', 'corruptKey']) {
    const storage = new Map([[FORMAL_KEY, old]]), fault = { [type]: key, noRollback: true };
    const platform = host(storage, fault), session = loadOrderSession(platform, NOW);
    assert.equal(session.compatibility, true, type + ':' + key);
    assert.equal(platform.compatibilityVersion, 4);
    assert.equal(storage.get(FORMAL_KEY), old);
    assert.deepEqual(session.legacySave, JSON.parse(old));
    const restart = host(storage);
    // Even a torn journal chooses the untouched source, never the candidate.
    const loaded = restart.load();
    assert.deepEqual(loaded, JSON.parse(old), type + ':' + key + ' cannot activate an uncommitted migration');
  }
});

test('trial migration failure pauses without a replacement save and can retry the preserved source', () => {
  const original = JSON.stringify(oldTrial()), storage = new Map([[LEGACY_SAVE_KEY, original]]);
  const session = loadOrderSession(host(storage, { writeKey: SAVE_KEY }), NOW);
  assert.equal(session.recoveryBlocked, true);
  assert.equal(storage.get(LEGACY_SAVE_KEY), original);
  assert.equal(storage.has(SAVE_KEY), false);
  const retry = loadOrderSession(host(storage), NOW);
  assert.equal(retry.recoveryBlocked, false);
  assert.equal(storage.get(LEGACY_SAVE_KEY), original);
});

test('corrupt current/source saves pause without overwrite and simultaneous sources are explicitly disclosed', () => {
  for (const key of [SAVE_KEY, FORMAL_KEY, LEGACY_SAVE_KEY]) {
    const storage = new Map([[key, '{bad']]);
    const session = loadOrderSession(host(storage), NOW);
    assert.equal(session.recoveryBlocked, true);
    assert.equal(storage.get(key), '{bad');
    assert.equal(storage.size, 1);
  }
  const trial = JSON.stringify(oldTrial());
  const storage = new Map([[FORMAL_KEY, JSON.stringify(oldFactory())], [LEGACY_SAVE_KEY, trial]]);
  const session = loadOrderSession(host(storage), NOW);
  assert.equal(session.recoveryBlocked, false);
  assert.match(session.message, /另有旧档保留/);
  assert.equal(storage.get(LEGACY_SAVE_KEY), trial);
});

test('existing different backup is never overwritten by automatic migration', () => {
  const key = SAVE_KEY + '_backup_' + FORMAL_KEY;
  const storage = new Map([[FORMAL_KEY, JSON.stringify(oldFactory())], [key, 'prior preserved backup']]);
  const session = loadOrderSession(host(storage), NOW);
  assert.equal(session.compatibility, true);
  assert.equal(storage.get(key), 'prior preserved backup');
  assert.equal(storage.has(SAVE_KEY), false);
});
