'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Game } = require('../src/core');
const { Renderer } = require('../src/renderer');
const { ProductionInsights } = require('../src/production-insights');
const { ART_ASSETS } = require('../src/art-manifest');
const { canvasHarness, deepFreeze } = require('./canvas-harness.cjs');

const EPSILON = 1e-6;
const VIEWPORTS = [
  { name: '390×844', width: 390, height: 844, safeTop: 0, menuBottom: 0 },
  { name: '320×524', width: 320, height: 524, safeTop: 0, menuBottom: 0 },
  // The formal platform has removed the 40 px bottom inset; the interface then
  // places its header at y=80, below the 75 px top/capsule exclusion.
  { name: '320×524 with safe areas', width: 320, height: 484, safeTop: 75, menuBottom: 0 }
];
const area = rect => rect[2] * rect[3];
function intersection(a, b) {
  return Math.max(0, Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0]))
    * Math.max(0, Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1]));
}
function inside(rect, bounds, message) {
  assert.ok(rect.every(Number.isFinite) && rect[2] > 0 && rect[3] > 0, message + ': valid positive art bounds');
  assert.ok(rect[0] >= bounds.x - EPSILON && rect[1] >= bounds.y - EPSILON
    && rect[0] + rect[2] <= bounds.x + bounds.w + EPSILON
    && rect[1] + rect[3] <= bounds.y + bounds.h + EPSILON, message + ': the entire rig remains in the production scene');
}
function assets() {
  const images = {};
  return { get(id) {
    assert.ok(ART_ASSETS[id], 'the formal renderer resolves a real manifest asset: ' + id);
    return images[id] || (images[id] = { id, width: ART_ASSETS[id].width, height: ART_ASSETS[id].height });
  }, report: () => ({ pending: 0, failed: 0 }) };
}
function ui(view, viewport, mode, stationId = null) {
  const station = view.stations.find(item => item.id === stationId);
  return deepFreeze({ viewport, modal: station ? { type: 'station', stationId } : null,
    stationCollapsed: mode === 'collapsed', stationDetails: mode === 'details',
    quote: station?.upgrade ? { stationId, level: station.level + 1, name: station.upgrade.name, cost: station.upgrade.cost } : null,
    purchaseFeedback: mode === 'collapsed' && view.state.upgrades.cup > 0 && stationId === 'cup'
      ? { stationId, name: '快速装杯头', atTick: view.state.simulation.ticks } : null,
    toast: '', toastSeconds: 0, newFactory: false, isDouyin: false, rateUpdatingUntil: 0 });
}
function views() {
  const game = new Game({ now: 1800000000000 }); game.tick(20.1);
  const before = new ProductionInsights().enrich(game.getView());
  assert.equal(game.buyUpgrade('cup').ok, true);
  const after = new ProductionInsights().enrich(game.getView());
  return [deepFreeze(before), deepFreeze(after)];
}

test('first-generation full-screen layouts keep both stock bins exposed, machines readable and every port connected through dock changes', t => {
  const maxima = { binMachine: 0, binBin: 0, machineMachine: 0 };
  const minimum = { machineWidth: Infinity, machineHeight: Infinity };
  for (const view of views()) for (const viewport of VIEWPORTS) {
    const canvas = canvasHarness(); canvas.ctx.globalAlpha = 1;
    const renderer = new Renderer(canvas.ctx, assets());
    const states = [{ mode: 'home', stationId: null }];
    for (const stationId of ['pop', 'cup', 'ship']) for (const mode of ['expanded', 'details', 'collapsed']) states.push({ mode, stationId });
    for (const { mode, stationId } of states) {
      const label = viewport.name + ' / ' + mode + ' / ' + (stationId || 'line');
      renderer.draw(view, ui(view, viewport, mode, stationId), 0);
      const layout = renderer.interface.layout, scene = renderer.scene;
      assert.equal(layout.header.y, viewport.safeTop ? 80 : 10, label + ': header respects the effective safe top');
      assert.equal(scene.artGeneration, 0, label + ': the formal entry uses first-generation art');
      assert.equal(scene.stationFrames.length, 3);
      assert.equal(scene.bufferFrames.length, 2);
      assert.ok(layout.scene.y + layout.scene.h <= layout.dock.y, label + ': operation panel does not cover the production path');

      const machines = scene.stationFrames.map(frame => {
        assert.equal(frame.art, true, label + ': machine has new art');
        assert.deepEqual(frame.artRect, scene.diagnostics.machines.find(item => item.stationId === frame.id).rect);
        inside(frame.artRect, layout.scene, label + ' / ' + frame.id);
        minimum.machineWidth = Math.min(minimum.machineWidth, frame.artRect[2]);
        minimum.machineHeight = Math.min(minimum.machineHeight, frame.artRect[3]);
        assert.ok(frame.artRect[2] >= 84, label + ': ' + frame.id + ' art remains at least 84 px wide');
        assert.ok(frame.artRect[3] >= 100, label + ': ' + frame.id + ' art remains at least 100 px high');
        assert.ok(frame.w >= 44 && frame.h >= 44, label + ': real machine keeps a 44 px touch region');
        return { id: frame.id, rect: frame.artRect };
      });
      const bins = scene.diagnostics.buffers;
      for (const bin of bins) {
        inside(bin.rect, layout.scene, label + ' / ' + bin.id + ' stock');
        for (const machine of machines) {
          const covered = intersection(bin.rect, machine.rect) / area(bin.rect);
          maxima.binMachine = Math.max(maxima.binMachine, covered);
          assert.ok(covered < .12, label + ': ' + bin.id + ' stock is hidden by ' + machine.id + ' over ' + (covered * 100).toFixed(2) + '% of its bounds');
        }
      }
      const binOverlap = intersection(bins[0].rect, bins[1].rect) / Math.min(area(bins[0].rect), area(bins[1].rect));
      maxima.binBin = Math.max(maxima.binBin, binOverlap);
      assert.ok(binOverlap < .1, label + ': the two stock bins remain independently readable');
      for (let i = 0; i < machines.length; i++) for (let j = i + 1; j < machines.length; j++) {
        const overlap = intersection(machines[i].rect, machines[j].rect) / Math.min(area(machines[i].rect), area(machines[j].rect));
        maxima.machineMachine = Math.max(maxima.machineMachine, overlap);
        // Isometric machine feet may overlap slightly in depth. A 20% ceiling
        // preserves that intended floor layering while catching merged machines.
        assert.ok(overlap <= .2, label + ': machine bodies have too much overlap');
      }
      const { nodes } = scene.placements(layout.scene.w, layout.scene.h);
      assert.equal(nodes.length, 10, label + ': every machine, stock bin and conveyor is assembled');
      for (const node of nodes) inside(node.rect, layout.scene, label + ' / ' + node.id);
      assert.equal(scene.diagnostics.connections.length, 9, label + ': the complete chain has nine joined boundaries');
      for (const connection of scene.diagnostics.connections) {
        const measured = Math.hypot(connection.fromPoint[0] - connection.toPoint[0], connection.fromPoint[1] - connection.toPoint[1]);
        assert.ok(measured < EPSILON && connection.gap < EPSILON, label + ': disconnected ' + connection.from + ' → ' + connection.to);
      }
      assert.equal(canvas.depth(), 0, label + ': every art and clip layer restores its Canvas state');
    }
  }
  t.diagnostic('Maximum art-bound overlaps: bin/machine ' + (maxima.binMachine * 100).toFixed(3) + '%, bin/bin '
    + (maxima.binBin * 100).toFixed(3) + '%, machine/machine ' + (maxima.machineMachine * 100).toFixed(3)
    + '%. Smallest machine ' + minimum.machineWidth.toFixed(3) + ' px wide / ' + minimum.machineHeight.toFixed(3) + ' px high.');
});

test('switching the selected first-generation station preserves the floor plan in expanded and collapsed docks', () => {
  const view = views()[1];
  for (const viewport of VIEWPORTS) for (const mode of ['expanded', 'collapsed']) {
    const canvas = canvasHarness(); canvas.ctx.globalAlpha = 1;
    const renderer = new Renderer(canvas.ctx, assets()); let geometry = null;
    for (const stationId of ['cup', 'pop', 'ship', 'cup']) {
      renderer.draw(view, ui(view, viewport, mode, stationId), 0);
      const next = {
        machines: renderer.scene.stationFrames.map(frame => ({ id: frame.id, rect: frame.artRect })),
        bins: renderer.scene.diagnostics.buffers.map(bin => ({ id: bin.id, rect: bin.rect })),
        connections: renderer.scene.diagnostics.connections
      };
      if (geometry) assert.deepEqual(next, geometry, viewport.name + ': selection does not shift a machine over a stock bin');
      else geometry = next;
      assert.ok(canvas.texts.some(entry => entry.text.startsWith('▸ ' + view.stations.find(item => item.id === stationId).name)), 'selection remains visible through runtime text');
      canvas.clear();
    }
  }
});
