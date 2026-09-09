'use strict';
const assert = require('node:assert/strict');

// Record text and Canvas geometry without DOM dependencies; stack accounting
// catches rendering corruption even when a runtime has no visual preview.
function canvasHarness() {
  let depth = 0, operations = 0;
  const texts = [], states = [];
  const ctx = {
    font: '14px sans-serif', textAlign: 'left', textBaseline: 'middle',
    save() { depth++; states.push({ font: this.font, textAlign: this.textAlign }); },
    restore() { assert.ok(depth > 0, 'balanced Canvas restore'); depth--; Object.assign(this, states.pop()); },
    measureText(value) { const size = Number((this.font.match(/([\d.]+)px/) || [0, 14])[1]); return { width: [...String(value)].reduce((n,c) => n + size * (c.charCodeAt(0) > 127 ? 1 : .55), 0) }; },
    fillText(value, x, y) { assert.ok(Number.isFinite(x) && Number.isFinite(y)); texts.push({ text: String(value), x, y, font: this.font, width: this.measureText(value).width, align: this.textAlign }); operations++; },
    createLinearGradient() { return { addColorStop() {} }; }, createRadialGradient() { return { addColorStop() {} }; }
  };
  for (const name of ['setTransform','transform','translate','scale','rotate','moveTo','lineTo','arcTo','arc','ellipse','fillRect','clearRect','strokeRect','quadraticCurveTo','bezierCurveTo','roundRect','rect','setLineDash']) {
    ctx[name] = (...args) => { assert.ok(args.every(value => Array.isArray(value) || typeof value === 'boolean' || Number.isFinite(value)), name + ' coordinates are finite'); operations++; };
  }
  for (const name of ['beginPath','closePath','fill','stroke','clip','drawImage']) ctx[name] = () => { operations++; };
  return { ctx, texts, depth: () => depth, operations: () => operations, clear() { texts.length = 0; } };
}
function deepFreeze(value) { if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.freeze(value); for (const child of Object.values(value)) deepFreeze(child); } return value; }
module.exports = { canvasHarness, deepFreeze };
