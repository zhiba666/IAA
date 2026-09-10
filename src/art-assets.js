'use strict';

const { ART_ASSETS, ART_RUNTIME_IDS } = require('./art-manifest');

function createArtAssets(options) {
  options = options || {};
  const root = options.root || (typeof globalThis !== 'undefined' ? globalThis : typeof GameGlobal !== 'undefined' ? GameGlobal : {});
  const sdk = root.tt || (typeof tt !== 'undefined' ? tt : null);
  const makeImage = options.createImage || (sdk && typeof sdk.createImage === 'function' ? () => sdk.createImage() :
    typeof root.Image === 'function' ? () => new root.Image() : null);
  const records = Object.create(null), pending = Object.create(null);
  const ids = (options.ids || ART_RUNTIME_IDS).slice();
  ids.forEach(id => { records[id] = { id, path: ART_ASSETS[id] && ART_ASSETS[id].path, status: 'pending', error: '' }; });
  function report() {
    const entries = Object.keys(records).map(id => ({ ...records[id], image: undefined }));
    return { requested: entries.length, loaded: entries.filter(item => item.status === 'loaded').length,
      failed: entries.filter(item => item.status === 'failed').length,
      pending: entries.filter(item => item.status === 'pending' || item.status === 'loading').length,
      complete: entries.every(item => item.status === 'loaded' || item.status === 'failed'),
      entries };
  }
  function changed() { if (typeof options.onChange === 'function') options.onChange(report()); }
  function load(id) {
    if (pending[id]) return pending[id];
    const asset = ART_ASSETS[id];
    const record = records[id] || (records[id] = { id, path: asset && asset.path, status: 'pending', error: '' });
    pending[id] = new Promise(resolve => {
      let settled = false, timer = null, img = null;
      function finish(error) {
        if (settled) return;
        settled = true;
        if (timer && typeof root.clearTimeout === 'function') root.clearTimeout(timer);
        record.status = error ? 'failed' : 'loaded'; record.error = error || '';
        if (!error) { record.image = img; record.width = img.naturalWidth || img.width || asset.width; record.height = img.naturalHeight || img.height || asset.height; }
        changed(); resolve(record);
      }
      if (!asset) { finish('unknown asset id'); return; }
      if (!makeImage) { finish('Image/tt.createImage is unavailable on this host'); return; }
      try {
        img = makeImage();
        record.status = 'loading';
        img.onload = function () {
          const width = img.naturalWidth || img.width, height = img.naturalHeight || img.height;
          finish(width && height && (width !== asset.width || height !== asset.height) ? 'decoded dimensions disagree with manifest' : '');
        };
        img.onerror = function () { finish('image load or decode failed: ' + asset.path); };
        if (typeof root.setTimeout === 'function') timer = root.setTimeout(() => finish('image loading timed out: ' + asset.path), options.timeoutMs || 15000);
        img.src = (options.basePath || '') + asset.path;
      } catch (error) { finish('image initialization failed: ' + error.message); }
    });
    return pending[id];
  }
  const api = { get: id => records[id] && records[id].status === 'loaded' ? records[id].image : null,
    load, report, ready: Promise.resolve(report()),
    loadAll() { api.ready = Promise.all(ids.map(load)).then(report); return api.ready; },
    retryFailed() {
      const failed = Object.keys(records).filter(id => records[id].status === 'failed');
      for (const id of failed) { delete pending[id]; records[id].status = 'pending'; records[id].error = ''; }
      return api.loadAll();
    } };
  return api;
}

module.exports = { createArtAssets };
