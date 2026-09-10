'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Game, CONFIG } = require('../src/core');
const { Renderer } = require('../src/renderer');
const { ProductionInsights } = require('../src/production-insights');
const { ART_ASSETS } = require('../src/art-manifest');
const { canvasHarness, deepFreeze } = require('./canvas-harness.cjs');

const viewports = [
  { width: 320, height: 524, safeTop: 0 },
  { width: 390, height: 844, safeTop: 0 },
  { width: 320, height: 484, safeTop: 75 }
];
function snapshot() {
  const game = new Game({ experiment: CONFIG.transferExperiment.id, now: 1800000000000 });
  game.tick(10);
  return new ProductionInsights().enrich(game.getView());
}
function ui(viewport, modal = null, transfer = null) {
  return { viewport, modal, transfer, stationCollapsed: false, stationDetails: false, toast: '', rateUpdatingUntil: 0 };
}
function render(view, state) {
  const canvas = canvasHarness(); canvas.ctx.globalAlpha = 1;
  const images = {};
  const renderer = new Renderer(canvas.ctx, { get(id) {
    assert.ok(ART_ASSETS[id]);
    return images[id] || (images[id] = { id });
  }, report: () => ({ pending: 0, failed: 0 }) });
  const before = JSON.stringify({ view, state });
  deepFreeze(view); deepFreeze(state); renderer.draw(view, state, .1);
  assert.equal(JSON.stringify({ view, state }), before, 'painting cannot mutate stock, reservations, or pointer state');
  assert.equal(canvas.depth(), 0);
  return { renderer, canvas };
}
function overlap(a, b) {
  return Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x))
    * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
}

test('manual transfer trays stay usable beside expanded purchase panels on small screens', () => {
  for (const viewport of viewports) for (const stationId of [null, 'pop', 'cup', 'ship']) {
    const view = snapshot(), state = ui(viewport, stationId ? { type: 'station', stationId } : null);
    const { renderer, canvas } = render(view, state);
    const source = renderer.scene.transferFrames.find(frame => frame.kind === 'tray');
    const target = renderer.scene.transferFrames.find(frame => frame.kind === 'input');
    const port = renderer.scene.transferFrames.find(frame => frame.kind === 'port');
    const bin = renderer.scene.transferFrames.find(frame => frame.kind === 'bin');
    assert.ok(source && target && bin && port, 'the bin and input each have a physical target and an accessible rail alternative');
    for (const zone of [source, target, bin, port]) {
      assert.ok(zone.w >= 56 && zone.h >= 56, 'transfer targets are at least 56 × 56');
      assert.ok(zone.x >= 0 && zone.y >= viewport.safeTop && zone.x + zone.w <= viewport.width
        && zone.y + zone.h <= renderer.interface.layout.dock.y, 'transfer targets remain above the upgrade panel');
      assert.equal(renderer.actionAt(zone.x + zone.w / 2, zone.y + zone.h / 2), zone.action);
      for (const corner of [[1,1], [zone.w-1,1], [1,zone.h-1], [zone.w-1,zone.h-1]]) {
        assert.equal(renderer.actionAt(zone.x+corner[0],zone.y+corner[1]),zone.action, 'every corner takes priority over machine selection');
      }
    }
    assert.equal(overlap(source, target), 0);
    assert.equal(overlap(bin, target), 0);
    assert.equal(overlap(source, port), 0);
    assert.equal(overlap(bin, port), 0, 'the smallest screen separates the physical source from the input port');
    const inputPoint = renderer.scene.diagnostics.machines.find(machine => machine.stationId === 'cup').ports.input;
    assert.equal(renderer.actionAt(...inputPoint), 'transfer:target', 'dragging onto the actual cup-machine input accepts the batch');
    const binArtwork = renderer.scene.diagnostics.buffers.find(buffer => buffer.id === 'pop').rect;
    assert.equal(renderer.actionAt(binArtwork[0] + binArtwork[2] / 2, binArtwork[1] + binArtwork[3] / 2), 'transfer:source', 'the physical stock centre remains directly draggable');
    const cupMachine = renderer.scene.stationFrames.find(frame => frame.id === 'cup');
    assert.equal(renderer.actionAt(cupMachine.x + cupMachine.w / 2, cupMachine.y + cupMachine.h / 2), 'station:cup', 'the machine centre remains available for opening upgrades');
    const cupLabel = canvas.texts.find(entry => /^(▸ )?装杯 · /.test(entry.text));
    assert.ok(cupLabel, 'the cup machine name and status remain visible above the equipment');
    const textSize = Number(cupLabel.font.match(/([\d.]+)px/)[1]);
    assert.equal(overlap({ x: cupLabel.x - cupLabel.width / 2, y: cupLabel.y - textSize / 2, w: cupLabel.width, h: textSize }, port), 0,
      'the real input marker does not cover the cup machine name or status');
    for (const zone of renderer.zones.filter(z => !z.action.startsWith('transfer:') && !z.action.startsWith('station:'))) {
      assert.equal(overlap(source, zone) + overlap(target, zone) + overlap(bin, zone) + overlap(port, zone), 0, 'transfer does not cover ' + zone.action);
    }
    assert.ok(!renderer.zones.some(zone => zone.action === 'evolve'), 'P0 cannot present expansion as available');
    assert.ok(canvas.texts.some(entry => entry.text.includes('A 段未接通')));
    assert.ok(canvas.texts.some(entry => entry.text === 'B 段正常'));
    assert.ok(canvas.texts.some(entry => entry.text.startsWith('装杯进料 ')));
    for (const entry of canvas.texts) {
      const left = entry.x - (entry.align === 'center' ? entry.width / 2 : entry.align === 'right' ? entry.width : 0);
      assert.ok(left >= -1 && left + entry.width <= viewport.width + 1, 'visible text fits: ' + entry.text);
    }
    if (stationId) assert.ok(canvas.texts.some(entry => entry.text.includes('无人操作基线')));
  }
});

test('dragging shows a read-only batch above the finger and only highlights targets with free input space', () => {
  const viewport = viewports[0], view = snapshot();
  const held = { token: 'visual-reservation', amount: 4, x: 230, y: 350, dragging: true, selected: true, overTarget: true };
  const { renderer, canvas } = render(view, ui(viewport, null, held));
  assert.equal(renderer.scene.diagnostics.transfer.legal, true);
  assert.equal(renderer.transferGhost.amount, 4);
  assert.ok(renderer.transferGhost.y + renderer.transferGhost.h < held.y, 'the batch count stays above the fingertip');
  assert.ok(canvas.texts.some(entry => entry.text === '4 份'));
  assert.ok(canvas.texts.some(entry => entry.text === '松手放入'));
  const full = { ...view, transfer: { ...view.transfer, inputAmount: view.transfer.inputCapacity } };
  const fullResult = render(full, ui(viewport, null, held));
  assert.equal(fullResult.renderer.scene.diagnostics.transfer.legal, false);
  assert.ok(fullResult.canvas.texts.some(entry => entry.text === '进料位已满'));
  const selected = render(view, ui(viewport, null, { ...held, dragging: false }));
  assert.equal(selected.renderer.transferGhost, null, 'a tapped reservation stays on the tray rather than following a stale pointer');
});

test('settings own input targets and the default game keeps the original rendering path', () => {
  const view = snapshot(), held = { amount: 4, x: 230, y: 350, dragging: true, overTarget: false };
  const settings = render(view, ui(viewports[0], { type: 'settings' }, held));
  assert.equal(settings.renderer.transferGhost, null);
  assert.ok(!settings.renderer.zones.some(zone => zone.action.startsWith('transfer:')));
  const original = new ProductionInsights().enrich(new Game().getView());
  const normal = render(original, ui(viewports[0]));
  assert.equal(normal.renderer.scene.transferFrames.length, 0);
  assert.ok(!normal.canvas.texts.some(entry => /手动|搬运试玩|A 段/.test(entry.text)));
  assert.ok(normal.canvas.texts.some(entry => entry.text.startsWith('扩建目标')));
});
