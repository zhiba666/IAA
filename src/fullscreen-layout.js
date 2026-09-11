'use strict';

const { createArtTransform, fitArtRect } = require('./art-layout');
const finite = (value, fallback) => Number.isFinite(value) ? value : fallback;

// The camera depends only on the viewport and permanent HUD reservations.
// Opening a modal, taking a tray or purchasing automation never changes it.
function sceneContentFrame(frame, presentation) {
  presentation = presentation || {};
  const viewport = presentation.viewport || {}, overlay = presentation.overlayLayout || {};
  const standalone = !presentation.viewport;
  const left = finite(overlay.leftInset, finite(viewport.safeLeft, 0) + 12);
  const right = finite(overlay.rightInset, finite(viewport.safeRight, 0) + 12);
  const top = finite(overlay.topInset, standalone ? 12 : Math.max(finite(viewport.safeTop, 0) + 8, finite(viewport.menuBottom, 0) + 8, 10) + 76);
  const bottom = finite(overlay.bottomInset, standalone ? 12 : finite(viewport.safeBottom, 0) + 76);
  return { x: frame.x + left, y: frame.y + top, w: Math.max(1, frame.w - left - right),
    h: Math.max(1, frame.h - top - bottom), exclusionRects: (overlay.exclusionRects || []).map(rect => ({ ...rect })) };
}

function fullScreenPlacements(frame, rigs, presentation) {
  const content = sceneContentFrame(frame, presentation), rowH = content.h / 3;
  const machineWidth = Math.max(44, content.w - 160), machineHeight = Math.max(44, Math.min(190, rowH - 18));
  const nodes = [], transfers = [];
  const add = (id, kind, box) => {
    const rig = rigs[id], rect = fitArtRect(rig.size, box, [0.5, 0.5]);
    const transform = createArtTransform({ x: rect[0], y: rect[1], scale: rect[2] / rig.size[0] });
    const node = { id, kind, rig, rect, transform, local: transform };
    nodes.push(node); return node;
  };
  ['pop', 'cup', 'ship'].forEach((id, index) => {
    const cy = content.y + rowH * (index + .5);
    add(id, 'machine', [content.x + 80, cy - machineHeight / 2, machineWidth, machineHeight]);
  });
  ['pop', 'cup'].forEach((source, index) => {
    const target = source === 'pop' ? 'cup' : 'ship';
    const tray = { x: content.x + content.w - 64, y: content.y + rowH * (index + .5) - 32,
      w: 64, h: 64, kind: 'tray', source, target, action: 'transfer-source-' + source };
    const input = { x: content.x, y: content.y + rowH * (index + 1.5) - 32,
      w: 64, h: 64, kind: 'input', source, target, action: 'transfer-target-' + target, tolerance: 12 };
    transfers.push(tray, input);
    add(source === 'pop' ? 'bulk' : 'cups', 'buffer', [tray.x, tray.y, tray.w, 46]);
  });
  add('outfeed', 'belt', [content.x + content.w - 64, content.y + rowH * 2.5 - 20, 64, 40]);
  return { nodes, content, transfers, compact: rowH < 130, rowH };
}

module.exports = { sceneContentFrame, fullScreenPlacements };
