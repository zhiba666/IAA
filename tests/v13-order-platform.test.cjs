'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../src/platform.js'), 'utf8');
const MODE = 'v13-orders-p0';
const KEY = 'little_popcorn_factory_orders_p0_v1';
const OLD_KEYS = ['little_popcorn_factory_v1', 'little_popcorn_factory_pipeline_v2',
  'little_popcorn_factory_manual_transfer_p0_v3', 'little_popcorn_factory_automation_v4'];

function harness(browser, options = {}) {
  const storage = new Map(), accesses = [];
  const canvas = { style: {}, addEventListener() {} };
  const faults = { failRead: false, failWrite: false, corruptWrite: false, failReadback: false };
  function read(key) {
    accesses.push(['read', key]);
    if (faults.failRead) throw new Error('read-denied');
    if (faults.failReadback === 'pending') { faults.failReadback = false; throw new Error('readback-denied'); }
    return storage.get(key);
  }
  function write(key, value) {
    accesses.push(['write', key]);
    if (faults.failWrite) { faults.failWrite = false; throw new Error('write-denied'); }
    if (faults.corruptWrite) { faults.corruptWrite = false; storage.set(key, '{incomplete'); }
    else storage.set(key, value);
    if (faults.failReadback === true) faults.failReadback = 'pending';
  }
  function remove(key) { accesses.push(['remove', key]); storage.delete(key); }
  const context = vm.createContext({
    module: { exports: {} },
    require: name => require(path.resolve(__dirname, '../src', name)),
    POPCORN_CONFIG: Object.assign({ mode: options.mode === undefined ? 'v15' : options.mode }, options.config),
    ...(browser ? {
      document: { getElementById: () => canvas, addEventListener() {} },
      window: { location: { search: options.search === undefined ? '?mode=' + MODE : options.search },
        addEventListener() {}, localStorage: { getItem: read, setItem: write, removeItem: remove } }
    } : {
      tt: { createCanvas: () => canvas, getStorageSync: read, setStorageSync: write, removeStorageSync: remove }
    })
  });
  if (options.gameGlobalOnly) { context.GameGlobal = vm.runInContext('this', context); context.globalThis = undefined; }
  vm.runInContext(source, context, { filename: 'src/platform.js' });
  const platform = context.module.exports.createPlatform();
  return { platform, storage, accesses, faults };
}

function documentSave(coins = 0) { return { version: 1, mode: MODE, marker: 'prototype', coins }; }
function protectOldSaves(h) {
  for (const [index, key] of OLD_KEYS.entries()) h.storage.set(key, JSON.stringify({ version: index + 1, machine: 5, coins: 987654 + index }));
  return OLD_KEYS.map(key => [key, h.storage.get(key)]);
}
function assertUntouched(h, original) {
  for (const [key, value] of original) assert.equal(h.storage.get(key), value, key + ' retained byte for byte');
  assert.ok(h.accesses.every(entry => entry[1] === KEY), 'prototype storage never accesses a legacy or live save key');
}

test('order prototype opts in before loading and isolates browser query and native config saves', () => {
  for (const browser of [true, false]) {
    const h = harness(browser, browser ? {} : { mode: MODE }), old = protectOldSaves(h);
    assert.equal(h.platform.config.mode, MODE);
    assert.equal(h.platform.saveKey, KEY);
    assert.equal(h.platform.load(), null, 'legacy saves are never imported into the limited prototype');
    assert.equal(h.platform.save(documentSave(21)), true);
    assert.equal(h.platform.load().coins, 21);
    assert.equal(h.platform.lastStorageError, '');
    assertUntouched(h, old);
  }
});

test('default formal entry never loads a prototype even when one exists', () => {
  for (const browser of [true, false]) {
    const h = harness(browser, { search: '' });
    h.storage.set(KEY, JSON.stringify(documentSave(999)));
    assert.equal(h.platform.config.mode, 'v15');
    assert.equal(h.platform.load(), null);
    assert.ok(h.accesses.every(entry => entry[1] !== KEY));
    assert.equal(JSON.parse(h.storage.get(KEY)).coins, 999);
  }
});

test('native GameGlobal config opts in and browser query requires an exact mode value', () => {
  const native = harness(false, { mode: MODE, gameGlobalOnly: true });
  assert.equal(native.platform.config.mode, MODE);
  assert.equal(native.platform.saveKey, KEY);
  assert.equal(native.platform.save(documentSave(12)), true);
  assert.equal(native.platform.load().coins, 12);
  for (const search of ['?mode=v13-orders-p0-extra', '?preview=v13-orders-p0', '?mode=v13-orders', '?xmode=v13-orders-p0']) {
    assert.equal(harness(true, { search }).platform.config.mode, 'v15', search);
  }
  for (const search of ['?mode=v13-orders-p0', '?foo=1&mode=v13-orders-p0&bar=2']) {
    assert.equal(harness(true, { search }).platform.config.mode, MODE, search);
  }
});

test('order storage rejects mismatched save envelopes before any mutation', () => {
  for (const browser of [true, false]) {
    const h = harness(browser, { mode: MODE }), old = protectOldSaves(h);
    const original = JSON.stringify(documentSave(18));
    h.storage.set(KEY, original);
    for (const invalid of [null, [], {}, { version: 1 }, { mode: MODE },
      { version: 4, mode: 'v15' }, { version: 2, mode: MODE }, { version: 1, mode: 'baseline' }]) {
      assert.equal(h.platform.save(invalid), false, JSON.stringify(invalid));
      assert.ok(h.platform.lastStorageError);
      assert.equal(h.storage.get(KEY), original);
    }
    const cyclic = documentSave(); cyclic.self = cyclic;
    assert.equal(h.platform.save(cyclic), false);
    assert.equal(h.storage.get(KEY), original);
    assert.ok(h.accesses.every(entry => entry[0] !== 'write' && entry[0] !== 'remove'));
    assertUntouched(h, old);
  }
});

test('invalid or inaccessible order storage is reported without destroying any saved bytes', () => {
  for (const browser of [true, false]) {
    const h = harness(browser, { mode: MODE }), old = protectOldSaves(h);
    for (const raw of ['{malformed', '[]', 'null', 'false', '23']) {
      h.storage.set(KEY, raw);
      assert.equal(h.platform.load(), null);
      assert.ok(h.platform.lastStorageError);
      assert.equal(h.storage.get(KEY), raw);
    }
    const original = JSON.stringify(documentSave(20));
    h.storage.set(KEY, original); h.faults.failRead = true;
    assert.equal(h.platform.load(), null);
    assert.match(h.platform.lastStorageError, /read-denied/);
    assert.equal(h.platform.save(documentSave(21)), false, 'cannot overwrite a save that could not be read first');
    assert.equal(h.storage.get(KEY), original);
    assert.ok(h.accesses.every(entry => entry[0] !== 'write' && entry[0] !== 'remove'));
    assertUntouched(h, old);
  }
});

test('order save readback failure restores the previous document or removes a failed first save', () => {
  for (const browser of [true, false]) for (const prior of [false, true]) {
    for (const fault of ['failWrite', 'corruptWrite', 'failReadback']) {
      const h = harness(browser, { mode: MODE }), old = protectOldSaves(h);
      const original = JSON.stringify(documentSave(16));
      if (prior) h.storage.set(KEY, original);
      h.faults[fault] = true;
      assert.equal(h.platform.save(documentSave(25)), false, fault);
      assert.ok(h.platform.lastStorageError, fault + ' is visible to the controller');
      assert.equal(h.storage.has(KEY), prior, fault + ' cannot activate an incomplete save');
      if (prior) assert.equal(h.storage.get(KEY), original, fault + ' restores the exact preceding document');
      assertUntouched(h, old);
      assert.equal(h.platform.save(documentSave(25)), true, 'a later successful write can recover');
      assert.equal(h.platform.load().coins, 25);
    }
  }
});
