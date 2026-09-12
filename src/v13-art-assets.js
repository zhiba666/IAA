'use strict';

const { V13_ART_ASSETS } = require('./v13-art-manifest');

const V13_ART_BUDGET_BYTES = 4 * 1024 * 1024;

function createV13ArtAssets(options) {
  options = options || {};
  const assets = options.assets || V13_ART_ASSETS;
  const root = options.root || (typeof globalThis !== 'undefined' ? globalThis : typeof GameGlobal !== 'undefined' ? GameGlobal : {});
  const sdk = root.tt || (typeof tt !== 'undefined' ? tt : null);
  const makeImage = options.createImage || (sdk && typeof sdk.createImage === 'function' ? () => sdk.createImage() :
    typeof root.Image === 'function' ? () => new root.Image() : null);
  const records = Object.create(null);
  let ids = [], decodedBytes = 0, disposed = false, selectionReady = null;

  function report() {
    const entries = ids.map(id => {
      const record = records[id];
      return { id, path: record.asset.path, status: record.status, error: record.error,
        width: record.width, height: record.height, decodedBytes: record.asset.width * record.asset.height * 4 };
    });
    return { requested: entries.length, loaded: entries.filter(entry => entry.status === 'loaded').length,
      failed: entries.filter(entry => entry.status === 'failed').length,
      pending: entries.filter(entry => entry.status === 'pending' || entry.status === 'loading').length,
      complete: entries.every(entry => entry.status === 'loaded' || entry.status === 'failed'),
      entries, decodedBytes, budgetBytes: V13_ART_BUDGET_BYTES };
  }

  function changed() { if (typeof options.onChange === 'function') options.onChange(report()); }

  function clearImage(record, release) {
    if (record.timer !== null && typeof root.clearTimeout === 'function') root.clearTimeout(record.timer);
    record.timer = null;
    const image = record.image;
    if (!image) return;
    image.onload = null;
    image.onerror = null;
    if (release) {
      record.image = null;
      try { image.src = ''; } catch (_) { /* Some native image hosts cannot clear src. */ }
    }
  }

  function release(record) {
    record.settled = true;
    clearImage(record, true);
    record.resolve();
  }

  function createRecord(id) {
    const record = { id, asset: assets[id], status: 'pending', error: '', image: null, timer: null, settled: false };
    record.promise = new Promise(resolve => { record.resolve = resolve; });
    return record;
  }

  function load(record) {
    if (record.status !== 'pending' || record.settled || records[record.id] !== record) return;
    function finish(error) {
      // A previous selection may have released this request before its host callback arrives.
      if (record.settled || records[record.id] !== record) return;
      record.settled = true;
      record.status = error ? 'failed' : 'loaded';
      record.error = error || '';
      if (!error) {
        record.width = record.image.naturalWidth || record.image.width || record.asset.width;
        record.height = record.image.naturalHeight || record.image.height || record.asset.height;
      }
      clearImage(record, !!error);
      record.resolve();
      changed();
    }
    if (!makeImage) { finish('Image/tt.createImage is unavailable on this host'); return; }
    try {
      const image = makeImage();
      record.image = image;
      record.status = 'loading';
      image.onload = function () {
        if (record.settled || records[record.id] !== record) return;
        const width = image.naturalWidth || image.width, height = image.naturalHeight || image.height;
        finish((width && width !== record.asset.width) || (height && height !== record.asset.height)
          ? 'decoded dimensions disagree with manifest' : '');
      };
      image.onerror = () => finish('image load or decode failed: ' + record.asset.path);
      if (typeof root.setTimeout === 'function') {
        record.timer = root.setTimeout(() => finish('image loading timed out: ' + record.asset.path), options.timeoutMs || 15000);
      }
      image.src = (options.basePath || '') + record.asset.path;
    } catch (error) { finish('image initialization failed: ' + error.message); }
  }

  function select(requested) {
    if (disposed) return Promise.reject(new Error('v1.3 art assets have been disposed'));
    let nextIds, nextBytes = 0;
    try {
      if (!Array.isArray(requested)) throw new TypeError('v1.3 asset selection must be an array of IDs');
      nextIds = [...new Set(requested)];
      for (const id of nextIds) {
        if (typeof id !== 'string' || !Object.prototype.hasOwnProperty.call(assets, id)) throw new Error('unknown v1.3 asset id: ' + String(id));
        const asset = assets[id];
        if (!asset || !Number.isSafeInteger(asset.width) || !Number.isSafeInteger(asset.height) || asset.width <= 0 || asset.height <= 0) {
          throw new Error('invalid v1.3 asset dimensions: ' + id);
        }
        nextBytes += asset.width * asset.height * 4;
      }
      if (nextBytes > V13_ART_BUDGET_BYTES) throw new Error('v1.3 art selection exceeds decoded memory budget: ' + nextBytes + ' > ' + V13_ART_BUDGET_BYTES);
    } catch (error) { return Promise.reject(error); }
    if (nextIds.length === ids.length && nextIds.every(id => records[id]) && selectionReady) return selectionReady;

    const nextSet = new Set(nextIds);
    for (const id of ids) {
      if (!nextSet.has(id)) {
        const record = records[id];
        delete records[id];
        release(record);
      }
    }
    ids = nextIds;
    decodedBytes = nextBytes;
    for (const id of ids) if (!records[id]) records[id] = createRecord(id);
    const selectedRecords = ids.map(id => records[id]);
    selectionReady = Promise.all(selectedRecords.map(record => record.promise)).then(report);
    const ready = selectionReady;
    selectedRecords.forEach(load);
    changed();
    return ready;
  }

  function retryFailed() {
    if (disposed) return Promise.reject(new Error('v1.3 art assets have been disposed'));
    const failed = ids.filter(id => records[id].status === 'failed');
    if (!failed.length) return selectionReady || Promise.resolve(report());
    for (const id of failed) {
      release(records[id]);
      records[id] = createRecord(id);
    }
    const selectedRecords = ids.map(id => records[id]);
    selectionReady = Promise.all(selectedRecords.map(record => record.promise)).then(report);
    const ready = selectionReady;
    selectedRecords.forEach(load);
    changed();
    return ready;
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    const previous = ids.map(id => records[id]);
    ids = [];
    decodedBytes = 0;
    for (const record of previous) { delete records[record.id]; release(record); }
    selectionReady = null;
    changed();
  }

  return { get: id => records[id] && records[id].status === 'loaded' ? records[id].image : null,
    select, retryFailed, report, dispose };
}

module.exports = { createV13ArtAssets, V13_ART_BUDGET_BYTES };
