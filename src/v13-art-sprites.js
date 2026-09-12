'use strict';

const { V13_ART_ASSETS } = require('./v13-art-manifest');
const { drawArtLayer, createArtTransform } = require('./art-layout');

function drawV13Sprite(ctx, art, id, rect, transform) {
  const asset = V13_ART_ASSETS[id];
  if (!asset) return false;
  return drawArtLayer(ctx, art, { id, rect }, transform || createArtTransform(), { asset });
}

module.exports = { drawV13Sprite };
