'use strict';

const { ART_ASSETS } = require('./art-manifest');

function createArtTransform(options) {
  options = options || {};
  const x = options.x == null ? 0 : options.x, y = options.y == null ? 0 : options.y, scale = options.scale == null ? 1 : options.scale;
  const flipX = !!options.flipX, horizontal = flipX ? -scale : scale;
  if (![x, y, scale].every(Number.isFinite) || scale <= 0) throw new Error('Art transforms require a positive uniform scale');
  return { x, y, scale, flipX,
    point(value) { return [x + value[0] * horizontal, y + value[1] * scale]; },
    points(values) { return values.map(value => this.point(value)); },
    rect(value) { return [x + (value[0] + (flipX ? value[2] : 0)) * horizontal, y + value[1] * scale, value[2] * scale, value[3] * scale]; },
    inversePoint(value) { return [(value[0] - x) / horizontal, (value[1] - y) / scale]; },
    child(value) { value = value || {}; return createArtTransform({ x: x + (value.x || 0) * horizontal,
      y: y + (value.y || 0) * scale, scale: scale * (value.scale == null ? 1 : value.scale), flipX: flipX !== !!value.flipX }); }
  };
}

function fitArtRect(size, rect, align) {
  const scale = Math.min(rect[2] / size[0], rect[3] / size[1]);
  align = align || [0.5, 0.5];
  return [rect[0] + (rect[2] - size[0] * scale) * align[0], rect[1] + (rect[3] - size[1] * scale) * align[1], size[0] * scale, size[1] * scale];
}

// This exported transform is also used for crop bounds, sprite-local ports,
// work-head pivots and hit geometry. No independent screen-scale arithmetic.
function artSpriteTransform(asset, layer, transform, offset) {
  offset = offset || [0, 0];
  const fit = fitArtRect([asset.width, asset.height], layer.rect);
  return transform.child({ x: fit[0] + offset[0] + (layer.flipX ? fit[2] : 0), y: fit[1] + offset[1],
    scale: fit[2] / asset.width, flipX: !!layer.flipX });
}

// Source-sheet coordinates first pass through the recorded export crop. The
// export's integer pixel rounding is respected; all subsequent placement remains
// uniform and shares the exact sprite transform used for drawing.
function sourceToSpritePoint(asset, point) {
  const crop = asset.sourceRect;
  if (!crop) return point.slice();
  return [(point[0] - crop[0]) * asset.width / crop[2], (point[1] - crop[1]) * asset.height / crop[3]];
}

function artSourcePoint(asset, layer, transform, point, offset) {
  return artSpriteTransform(asset, layer, transform, offset).point(sourceToSpritePoint(asset, point));
}

function drawArtLayer(ctx, images, layer, transform, options) {
  options = options || {};
  const asset = ART_ASSETS[layer.id], img = images && (typeof images.get === 'function' ? images.get(layer.id) : images[layer.id]);
  if (!asset || !img || typeof ctx.drawImage !== 'function') return false;
  const sprite = artSpriteTransform(asset, layer, transform, options.offset);
  const crop = options.crop || layer.crop || [0, 0, asset.width, asset.height];
  const dest = sprite.rect(crop);
  ctx.save();
  if (sprite.flipX) {
    ctx.translate(dest[0] * 2 + dest[2], 0); ctx.scale(-1, 1);
  }
  if (options.alpha != null) ctx.globalAlpha *= options.alpha;
  ctx.drawImage(img, crop[0], crop[1], crop[2], crop[3], dest[0], dest[1], dest[2], dest[3]);
  ctx.restore();
  return true;
}

function clipArtPolygon(ctx, polygon, transform) {
  if (!polygon || polygon.length < 3) return;
  const points = transform.points(polygon);
  ctx.beginPath(); ctx.moveTo(points[0][0], points[0][1]);
  points.slice(1).forEach(point => ctx.lineTo(point[0], point[1]));
  ctx.closePath(); ctx.clip();
}

function minimumHitRect(rect, minimum, bounds) {
  minimum = minimum || 44;
  const result = [rect[0] - Math.max(0, minimum - rect[2]) / 2, rect[1] - Math.max(0, minimum - rect[3]) / 2,
    Math.max(minimum, rect[2]), Math.max(minimum, rect[3])];
  if (bounds) {
    result[0] = Math.max(bounds[0], Math.min(result[0], bounds[0] + bounds[2] - result[2]));
    result[1] = Math.max(bounds[1], Math.min(result[1], bounds[1] + bounds[3] - result[3]));
  }
  return result;
}

// Both transfer methods use these same two inventory rows. Reserving space in
// the scene keeps the 56 px inputs clear of expanded equipment purchase panels.
function transferRailLayout(frame) {
  const rowH = 56, gap = 8, margin = 8, middle = 20;
  const cardW = (frame.w - margin * 2 - middle) / 2;
  const top = frame.y + frame.h - (rowH * 2 + gap + margin);
  return ['pop', 'cup'].map((source, index) => {
    const target = source === 'pop' ? 'cup' : 'ship', y = top + index * (rowH + gap);
    return { source, target,
      tray: { x: frame.x + margin, y, w: cardW, h: rowH, kind: 'tray', source, target, action: 'transfer-source-' + source },
      input: { x: frame.x + frame.w - margin - cardW, y, w: cardW, h: rowH, kind: 'input', source, target, action: 'transfer-target-' + target }
    };
  });
}

function drawNineSlice(ctx, images, id, rect, options) {
  options = options || {};
  const asset = ART_ASSETS[id], img = images && (typeof images.get === 'function' ? images.get(id) : images[id]);
  if (!asset || !img || typeof ctx.drawImage !== 'function') return false;
  const border = options.sourceBorder || 32;
  const edge = Math.min(options.border == null ? 10 : options.border, rect[2] / 2, rect[3] / 2);
  const sx = [0, border, asset.width - border, asset.width], sy = [0, border, asset.height - border, asset.height];
  const dx = [rect[0], rect[0] + edge, rect[0] + rect[2] - edge, rect[0] + rect[2]],
    dy = [rect[1], rect[1] + edge, rect[1] + rect[3] - edge, rect[1] + rect[3]];
  for (let row = 0; row < 3; row++) for (let col = 0; col < 3; col++) {
    if (dx[col + 1] > dx[col] && dy[row + 1] > dy[row]) ctx.drawImage(img,
      sx[col], sy[row], sx[col + 1] - sx[col], sy[row + 1] - sy[row],
      dx[col], dy[row], dx[col + 1] - dx[col], dy[row + 1] - dy[row]);
  }
  return true;
}

module.exports = { createArtTransform, fitArtRect, artSpriteTransform, sourceToSpritePoint, artSourcePoint,
  drawArtLayer, clipArtPolygon, minimumHitRect, transferRailLayout, drawNineSlice };
