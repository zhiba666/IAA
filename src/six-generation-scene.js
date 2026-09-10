'use strict';

const { FirstGenerationScene } = require('./first-generation-scene');
const { ART_ASSETS, ART_RIGS, ART_GENERATION_RIGS, ART_SIX_GEN } = require('./art-manifest');
const { createArtTransform, minimumHitRect } = require('./art-layout');
const { ART_EFFECTS } = require('./art-effects');

const clamp = n => Math.max(0, Math.min(1, Number.isFinite(n) ? n : 0));
const amountOf = n => Math.max(0, Number.isFinite(n) ? Math.floor(n) : 0);
const identity = () => createArtTransform();
const sameLayer = (a, b) => a && b && a.id === b.id && a.rect.every((n, i) => n === b.rect[i]);

// This module consumes the live view only. Generation selects a housing; it
// never grants lanes, changes a batch already in flight, or moves inventory.
class SixGenerationScene extends FirstGenerationScene {
  constructor(ctx, assets) {
    super(ctx, assets);
    this.generation = 1;
    this.transferHeight = 0;
  }

  rigFor(stationId, generation = this.generation) {
    return ART_GENERATION_RIGS.find(row => row.generation === generation && row.stationId === stationId)?.rig;
  }

  logisticsRig(id) { return ART_SIX_GEN.logistics.rigs.find(rig => rig.id === id); }

  placements(w, h) {
    if (this.generation === 1) return super.placements(w, h);
    const compact = h < 380;
    const rigs = Object.fromEntries(['pop', 'cup', 'ship'].map(id => [id, this.rigFor(id)]));
    rigs.bulk = this.generation >= 3 ? this.logisticsRig('bulk_large') : ART_RIGS.bulkBuffer;
    rigs.cups = this.generation >= 3 ? this.logisticsRig('cups_rack') : ART_RIGS.cupsBuffer;
    const machineScale = (id, extent) => extent / Math.max(...rigs[id].size);
    // Both floor plans join the actual local ports. Short screens turn the
    // material route back through the room instead of stretching any artwork.
    const rows = compact ? [
      ['pop', rigs.pop, machineScale('pop', 130)], ['belt_pop_bulk', ART_RIGS.conveyorRight, .13],
      ['bulk', rigs.bulk, .13], ['belt_bulk_cup', ART_RIGS.conveyorLeft, .26, true],
      ['cup', rigs.cup, machineScale('cup', 135)], ['belt_cup_stock', ART_RIGS.conveyorLeft, .34],
      ['cups', rigs.cups, .13], ['belt_stock_ship', ART_RIGS.conveyorTransfer, .105],
      ['ship', rigs.ship, machineScale('ship', 130)], ['outfeed', ART_RIGS.conveyorOutfeed, .10]
    ] : [
      ['pop', rigs.pop, machineScale('pop', 150)], ['belt_pop_bulk', ART_RIGS.conveyorRight, .22],
      ['bulk', rigs.bulk, .18], ['belt_bulk_cup', ART_RIGS.conveyorLeft, .30],
      ['cup', rigs.cup, machineScale('cup', 145)], ['belt_cup_stock', ART_RIGS.conveyorRight, .23],
      ['cups', rigs.cups, .18], ['belt_stock_ship', ART_RIGS.conveyorLeft, .38],
      ['ship', rigs.ship, machineScale('ship', 145)], ['outfeed', ART_RIGS.conveyorOutfeed, .16]
    ];
    const nodes = [];
    for (const [id, source, scale, reverse] of rows) {
      const rig = reverse ? { ...source, input: source.output, output: source.input } : source;
      const previous = nodes[nodes.length - 1];
      const from = previous?.local.point(previous.rig.output);
      const local = createArtTransform({ x: from ? from[0] - rig.input[0] * scale : 0,
        y: from ? from[1] - rig.input[1] * scale : 0, scale });
      nodes.push({ id, rig, local, kind: id.startsWith('belt') || id === 'outfeed' ? 'belt' : ['bulk', 'cups'].includes(id) ? 'buffer' : 'machine' });
    }
    const rects = nodes.map(node => node.local.rect([0, 0, ...node.rig.size]));
    const minX = Math.min(...rects.map(r => r[0])), minY = Math.min(...rects.map(r => r[1]));
    const width = Math.max(...rects.map(r => r[0] + r[2])) - minX;
    const height = Math.max(...rects.map(r => r[1] + r[3])) - minY;
    const scale = Math.max(.01, Math.min((w - 16) / width, (h - 32) / height));
    const scene = createArtTransform({ x: this.frame.x + (w - width * scale) / 2 - minX * scale,
      y: this.frame.y + 16 + Math.max(0, (h - 32 - height * scale) / 2) - minY * scale, scale });
    for (const node of nodes) {
      node.transform = scene.child(node.local);
      node.rect = node.transform.rect([0, 0, ...node.rig.size]);
    }
    return { nodes, compact };
  }

  draw(x, y, w, h, view) {
    this.generation = Math.max(1, Math.min(6, amountOf(view.state.machine) + 1));
    if (this.generation === 1) return super.draw(x, y, w, h, view);
    if (![x, y, w, h].every(Number.isFinite) || w <= 0 || h <= 0) return;
    this.artGeneration = this.generation - 1;
    this.frame = { x, y, w, h };
    this.stationFrames = []; this.bufferFrames = []; this.transferFrames = [];
    this.compactTransfers = view.mode === 'v15' && view.transfers?.length === 2
      && view.transfers.every(row => row.automated) && !view.presentation?.transfer?.amount;
    this.transferHeight = view.mode === 'v15' ? (this.compactTransfers ? 64 : 132) : view.transfer?.enabled ? 80 : 0;
    const { nodes, compact } = this.placements(w, h - this.transferHeight);
    const byId = Object.fromEntries(nodes.map(node => [node.id, node]));
    this.diagnostics = { generation: this.generation, layout: compact ? 'compact-return-loop' : 'tall-zigzag',
      frame: { x, y, w, h }, machines: [], buffers: [], connections: [], decorations: [], transferHeight: this.transferHeight, fallbacks: [] };
    const c = this.c;
    c.save(); this.box(x, y, w, h, 16, '#f0e1c4'); c.clip();
    const room = ART_ASSETS.factory_room;
    const roomScale = Math.max(w / room.width, h / room.height);
    this.sprite('factory_room', [x + (w - room.width * roomScale) / 2, y, room.width * roomScale, room.height * roomScale], identity());
    this.decorations(byId, h - this.transferHeight);
    for (let i = 1; i < nodes.length; i++) {
      const a = nodes[i - 1].transform.point(nodes[i - 1].rig.output), b = nodes[i].transform.point(nodes[i].rig.input);
      this.diagnostics.connections.push({ from: nodes[i - 1].id, to: nodes[i].id, fromPoint: a, toPoint: b, gap: Math.hypot(a[0] - b[0], a[1] - b[1]) });
    }
    nodes.filter(node => node.kind === 'belt').forEach(node => this.belt(node, view));
    const solids = nodes.filter(node => node.kind !== 'belt').sort((a, b) => a.transform.point(a.rig.anchor)[1] - b.transform.point(b.rig.anchor)[1]);
    for (const node of solids) {
      if (node.kind === 'machine') this.machine(node, view.stations.find(station => station.id === node.id), view);
      else this.stock(node, view.buffers[node.id === 'bulk' ? 0 : 1]);
    }
    for (const id of ['cup', 'ship']) {
      const port = byId[id].transform.point(byId[id].rig.input);
      // The collar is only a visual mouth. Interaction still belongs to the
      // controller's existing reservation targets and the enlarged rail.
      this.sprite('input_cup_collar', [port[0] - 11, port[1] - 7.62, 22, 15.24], identity());
    }
    for (const id of ['pop', 'cup', 'ship']) this.machineLabel(byId[id], view.stations.find(station => station.id === id), view, compact);
    for (const id of ['bulk', 'cups']) this.stockLabel(byId[id], view.buffers[id === 'bulk' ? 0 : 1], compact);
    if (view.mode === 'v15') this.logisticsControls(byId, view);
    else if (view.transfer?.enabled) this.transferControls(byId, view);
    if (this.delivery) {
      const r = byId.outfeed.rect;
      this.label('+' + this.delivery.coins + ' 金', Math.min(x + w - 26, r[0] + r[2] * .6), Math.min(y + h - this.transferHeight - 6, r[1] + r[3] + 5), 11, '#176968', 'center');
    }
    c.restore();
    return { frame: this.frame, stationFrames: this.stationFrames, bufferFrames: this.bufferFrames };
  }

  decorations(nodes, availableHeight) {
    const { x, y, w } = this.frame;
    if (this.generation === 6) {
      const tower = ART_SIX_GEN.scene.tower;
      const scale = Math.min(w * .49 / tower.size[0], availableHeight * .94 / tower.size[1]);
      const t = createArtTransform({ x: x + w - tower.size[0] * scale - 5, y: y + 4, scale });
      // Both halves share the authored 512×760 canvas. This landmark is below
      // machinery in the scene stack, including its local foreground frame.
      for (const layer of tower.layers) {
        this.part(layer, t, { alpha: .58 });
        this.diagnostics.decorations.push({ id: layer.id, rect: t.rect(layer.rect), transform: { x: t.x, y: t.y, scale: t.scale }, behindMachines: true });
      }
    }
    const r = nodes.pop.rect, width = r[2] * 1.04, height = width * 318 / 512;
    const rect = [r[0] - (width - r[2]) / 2, r[1] + r[3] - height * .65, width, height];
    this.sprite('factory_platform_extension', rect, identity());
    this.diagnostics.decorations.push({ id: 'factory_platform_extension', rect, behindMachines: true });
  }

  withClip(polygon, transform, draw) { if (polygon?.length) this.clipped(polygon, transform, draw); else draw(); }

  packageAt(rect, transform, amount, progress = 1, closed = false) {
    if (amount === 1) { this.cupAt(rect, transform, progress); return; }
    const rig = ART_SIX_GEN.packaging[amount === 2 ? 'doubleTray' : 'fourCupBox'];
    const scale = Math.min(rect[2] / rig.size[0], rect[3] / rig.size[1]);
    const t = transform.child({ x: rect[0] + (rect[2] - rig.size[0] * scale) / 2, y: rect[1] + rect[3] - rig.size[1] * scale, scale });
    const layers = rig.parts.filter(part => part.state !== 'closed' || closed).map(part => ({
      layer: part.layer, draw: () => this.withClip(typeof part.clip === 'string' ? rig[part.clip] : part.clip, t, () => this.part(part, t))
    }));
    for (const slot of rig.slots.slice(0, amount)) layers.push({ layer: slot.layer,
      draw: () => this.withClip(rig.contentClip, t, () => this.cupAt(slot.rect, t, progress)) });
    layers.sort((a, b) => a.layer - b.layer).forEach(layer => layer.draw());
  }

  trayAt(rect, transform, amount, kind = 'kernel') {
    const rig = this.logisticsRig('transfer_tray');
    const scale = Math.min(rect[2] / rig.size[0], rect[3] / rig.size[1]);
    const t = transform.child({ x: rect[0] + (rect[2] - rig.size[0] * scale) / 2, y: rect[1] + (rect[3] - rig.size[1] * scale) / 2, scale });
    rig.layers.forEach(layer => this.part(layer, t));
    this.clipped(rig.contentClip, t, () => {
      for (let i = 0; i < Math.min(rig.maxRepresentativeProducts, amountOf(amount)); i++) {
        const row = Math.floor(i / 3), col = i % 3;
        const r = [71 + col * 23 - row * 24, 38 + col * 11 + row * 15, 22, 27.08];
        if (kind === 'cup') this.cupAt(r, t);
        else this.sprite(i % 2 ? 'product_kernel_b' : 'product_kernel_a', [r[0], r[1] + 9, 20, 20], t);
      }
    });
  }

  machine(node, station, view) {
    if (this.generation === 1) {
      const ids = node.rig.layers.map(layer => layer.id);
      if (station.jobs?.some(Boolean)) ids.push('product_cup_fill', ...(station.id === 'pop' ? [] : ['product_cup_empty']));
      const missing = [...new Set(ids)].filter(id => !this.art?.get(id));
      if (!missing.length) return super.machine(node, station, view);
      const art = this.art;
      // Keep the original first-generation interaction and diagnostic geometry
      // even when a single missing component requires a whole-machine fallback.
      try { this.art = { get: () => null }; super.machine(node, station, view); }
      finally { this.art = art; }
      this.drawStationArtwork(...node.rect, station, 0);
      this.diagnostics.machines[this.diagnostics.machines.length - 1].fallback = true;
      (this.diagnostics.fallbacks || (this.diagnostics.fallbacks = [])).push({ stationId: station.id, missing });
      return;
    }
    const { rig, transform: t } = node;
    const installed = Math.min(rig.slots.length, amountOf(station.lanes));
    const layers = rig.layers.filter(layer => !rig.slots.some(slot => [slot.head, slot.cup, slot.content, slot.cover].some(part => sameLayer(layer, part))))
      .map(layer => ({ layer: layer.layer, ids: [layer.id], draw: () => this.part(layer, t) }));
    const diag = { stationId: station.id, rigId: rig.id, status: station.status, rect: node.rect, lanes: installed,
      ports: { input: t.point(rig.input), output: t.point(rig.output) }, jobs: [], slots: [] };
    for (const [index, slot] of rig.slots.entries()) {
      const active = index < installed;
      const job = active ? station.jobs?.[index] : null;
      const p = job ? clamp(job.progress) : 0;
      const travel = slot.head.travel || [0, slot.head.rect[3] * (station.id === 'pop' ? 70 / 418.5 : 16 / 200)];
      const movement = job && !job.complete ? Math.sin(p * Math.PI) : 0;
      const offset = travel.map(n => n * movement);
      const amount = job ? amountOf(job.amount) : 0;
      const packageKind = !amount ? null : station.id === 'pop' ? amount === 2 ? 'doubleCarrier' : 'kernels' : amount === 1 ? 'cup' : amount === 2 ? 'doubleTray' : 'fourCupBox';
      diag.slots.push({ index, installed: active, coverVisible: !active && !!slot.cover, headVisible: active,
        amount, progress: p, complete: !!job?.complete, headOffset: offset[1], packageKind });
      if (job) diag.jobs.push({ index, amount: job.amount, progress: job.progress, complete: job.complete, headOffset: offset[1], packageKind });
      if (slot.front && !rig.layers.some(layer => sameLayer(layer, slot.front))) layers.push({ layer: slot.front.layer, ids: [slot.front.id], draw: () => this.part(slot.front, t) });
      if (!active) {
        if (slot.cover) layers.push({ layer: slot.cover.layer, ids: [slot.cover.id], draw: () => this.part(slot.cover, t) });
        continue;
      }
      layers.push({ layer: slot.head.layer, ids: [slot.head.id], draw: () => this.part(slot.head, t, { offset }) });
      if (station.id === 'pop' && job && !job.complete && p > 0) {
        const r = slot.head.rect, width = r[2] * .6;
        layers.push({ layer: slot.head.layer + 1, ids: ['fx_steam'], draw: () => this.sprite('fx_steam',
          [r[0] + r[2] * .45, r[1] - width * (.2 + p * .2), width, width * 1.2], t,
          { alpha: Math.sin(p * Math.PI) * ART_EFFECTS.processing.steamOpacity }) });
      }
      if (!job || amount === 0) continue;
      const clip = slot.clip || slot.contentClip || rig.contentClip;
      const content = slot.cup || slot.content;
      const batchRect = slot.batchContent?.rect || slot.packagingRect || slot.carrier?.rect;
      if (station.id === 'pop') {
        if (amount === 2 && slot.carrier) layers.push({ layer: slot.carrier.layer, ids: [slot.carrier.id], draw: () => this.withClip(clip, t, () => this.part(slot.carrier, t)) });
        layers.push({ layer: amount === 2 && slot.carrier ? slot.carrier.layer + 1 : content.layer, ids: ['product_cup_fill'], draw: () => this.withClip(clip, t, () => {
          if (amount === 2) {
            const r = batchRect || content.rect, width = r[2] * .34, height = width * 94 / 128;
            this.sprite('product_cup_fill', [r[0] + r[2] * .19, r[1] + r[3] * .16, width, height], t);
            this.sprite('product_cup_fill', [r[0] + r[2] * .50, r[1] + r[3] * .34, width, height], t);
          } else this.part(content, t);
        }) });
      } else {
        const r = amount === 1 ? slot.singleCupRect || content.rect : batchRect || content.rect;
        const ids = ['product_cup_empty', 'product_cup_fill'];
        if (amount === 2) ids.push('product_double_tray');
        else if (amount >= 4) ids.push('product_box_open', 'product_box_front', ...(job.complete ? ['product_box_lid'] : []));
        layers.push({ layer: content.layer, ids, draw: () => this.withClip(clip, t,
          () => this.packageAt(r, t, amount, station.id === 'cup' ? (job.complete ? 1 : p) : 1, station.id === 'ship' && !!job.complete)) });
      }
    }
    const selected = view.presentation?.selectedStationId === station.id;
    if (selected) { const r = node.rect; this.box(r[0] - 2, r[1] - 2, r[2] + 4, r[3] + 4, 10, 'rgba(255,245,200,.26)', '#267d7e'); }
    const missing = [...new Set(layers.flatMap(layer => layer.ids))].filter(id => !this.art?.get(id));
    if (missing.length) {
      this.drawStationArtwork(...node.rect, station, this.generation - 1);
      diag.fallback = true; this.diagnostics.fallbacks.push({ stationId: station.id, missing });
    } else layers.sort((a, b) => a.layer - b.layer).forEach(layer => layer.draw());
    if (this.flash && (!this.flash.stationId || this.flash.stationId === station.id)) {
      const r = node.rect, p = 1 - this.flash.remaining / this.flash.duration;
      this.sprite('fx_sparkle', [r[0] + r[2] * .55, r[1] + r[3] * .08 - p * 8, 24, 24], identity(), { alpha: Math.min(1, this.flash.remaining) });
    }
    this.diagnostics.machines.push(diag);
    const region = rig.hitPolygon || rig.clickRegion || [[0, 0], [rig.size[0], 0], rig.size, [0, rig.size[1]]];
    const points = t.points(region), xs = points.map(p => p[0]), ys = points.map(p => p[1]);
    const hit = minimumHitRect([Math.min(...xs), Math.min(...ys), Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)], 44,
      [this.frame.x, this.frame.y, this.frame.w, this.frame.h - this.transferHeight]);
    this.stationFrames.push({ id: station.id, x: hit[0], y: hit[1], w: hit[2], h: hit[3], art: true, artRect: node.rect, textX: hit[0] });
  }

  stock(node, buffer) {
    if (this.generation < 3) return super.stock(node, buffer);
    const { rig, transform: t } = node, amount = amountOf(buffer.amount), capacity = Math.max(1, buffer.capacity);
    const count = amount === 0 ? 0 : Math.min(amount, rig.content.slots.length, Math.max(1, Math.ceil(clamp(amount / capacity) * rig.content.slots.length)));
    if (rig.layers.some(layer => !this.art?.get(layer.id))) {
      const [x, y, w, h] = node.rect;
      this.box(x, y + h * .24, w, h * .7, 5, '#d4c8a6', '#a99570');
      this.box(x + 3, y + h * .28, w - 6, h * .54, 3, '#ece3cb');
      if (amount) this.box(x + 4, y + h * .3, (w - 8) * clamp(amount / capacity), h * .49, 2, '#e3ce91');
      for (let i = 0; i < count; i++) {
        const xx = x + w * (.14 + i * .14), yy = y + h * .59;
        if (node.id === 'cups') this.cup(xx, yy, 1, Math.min(w / 230, h / 65));
        else this.popcorn(xx, yy, Math.min(w / 24, h / 15), i);
      }
      this.diagnostics.fallbacks.push({ bufferId: buffer.id, missing: rig.layers.filter(layer => !this.art?.get(layer.id)).map(layer => layer.id) });
    } else {
      rig.layers.filter(layer => layer.layer < rig.content.layer).forEach(layer => this.part(layer, t));
      this.clipped(rig.contentClip, t, () => rig.content.slots.slice(0, count).forEach((r, index) => {
        if (rig.content.kind === 'cups') this.cupAt(r, t);
        else this.sprite(index % 2 ? 'product_kernel_b' : 'product_kernel_a', r, t);
      }));
      rig.layers.filter(layer => layer.layer >= rig.content.layer).forEach(layer => this.part(layer, t));
    }
    const r = node.rect;
    this.bufferFrames.push({ id: buffer.id, x: r[0], y: r[1], w: r[2], h: r[3], art: true });
    this.diagnostics.buffers.push({ id: buffer.id, amount, capacity: buffer.capacity, rect: r, full: amount >= buffer.capacity, representativeCount: count, representativeLimit: rig.content.slots.length });
  }

  stockLabel(node, buffer, compact) {
    if (this.generation === 1) return super.stockLabel(node, buffer, compact);
    const text = (node.id === 'bulk' ? '待装 ' : '待发 ') + buffer.amount + '/' + buffer.capacity;
    const size = compact ? 10 : 12;
    this.c.font = `700 ${size}px "Microsoft YaHei", "PingFang SC", sans-serif`;
    const width = Math.min(this.frame.w - 12, Math.max(76, this.c.measureText(text).width + 10));
    const r = node.rect;
    const x = Math.max(this.frame.x + width / 2 + 3, Math.min(this.frame.x + this.frame.w - width / 2 - 3, r[0] + r[2] / 2));
    const y = Math.min(this.frame.y + this.frame.h - this.transferHeight - 10, r[1] + r[3] + 8);
    this.box(x - width / 2, y - 8, width, 16, 5, 'rgba(255,250,232,.94)');
    this.label(text, x, y, size, buffer.amount >= buffer.capacity ? '#925f29' : '#235f63', 'center');
  }

  logisticsControls(nodes, view) {
    if (this.generation === 1 || !this.compactTransfers) return super.logisticsControls(nodes, view);
    const { x, y, w, h } = this.frame, top = y + h - 60, cellW = (w - 28) / 4;
    this.diagnostics.transfers = [];
    for (const [index, sourceId] of ['pop', 'cup'].entries()) {
      const transfer = view.transfers.find(row => row.source === sourceId), buffer = view.buffers.find(row => row.id === sourceId);
      const source = { x: x + 6 + index * (cellW * 2 + 8), y: top, w: cellW, h: 56, kind: 'tray', source: sourceId, target: transfer.target, action: 'transfer-source-' + sourceId };
      const target = { ...source, x: source.x + cellW + 4, kind: 'input', action: 'transfer-target-' + transfer.target };
      this.transferFrames.push(source, target);
      for (const frame of [source, target]) this.box(frame.x, frame.y, frame.w, frame.h, 9, frame.kind === 'tray' ? '#fff7df' : '#edf2e1', '#a8b595');
      this.trayAt([source.x + 3, top + 3, 24, 17], identity(), 0);
      this.sprite('input_cup_collar', [target.x + 4, top + 4, 23, 15.93], identity());
      this.label(index === 0 ? '待装仓' : '待发仓', source.x + cellW / 2 + 7, top + 12, 10, '#526449', 'center');
      this.label(index === 0 ? '装杯口' : '出货口', target.x + cellW / 2 + 7, top + 12, 10, '#38654d', 'center');
      this.label(buffer.amount + '/' + buffer.capacity, source.x + cellW / 2, top + 29, 10, '#765022', 'center');
      this.label(transfer.inputAmount + '/' + transfer.inputCapacity, target.x + cellW / 2, top + 29, 10, '#236853', 'center');
      const full = transfer.inputAmount >= transfer.inputCapacity;
      this.label('已接通', source.x + cellW / 2, top + 45, 10, '#38654d', 'center');
      this.label(full ? '入口已满' : '自动补料', target.x + cellW / 2, top + 45, 10, full ? '#946337' : '#38654d', 'center');
      this.diagnostics.transfers.push({ source, target, amount: 0, inputAmount: transfer.inputAmount, inputCapacity: transfer.inputCapacity,
        automated: true, legal: false, overTarget: false, inputPoint: nodes[transfer.target].transform.point(nodes[transfer.target].rig.input), physicalInput: null });
    }
  }

  belt(node, view) {
    if (this.generation === 1) return super.belt(node, view);
    // A later lane may be working while lane zero is empty or blocked. Select
    // one real live batch as the bounded transit marker without advancing it.
    const stationId = node.id === 'belt_pop_bulk' ? 'pop' : node.id === 'belt_stock_ship' ? 'ship' : 'cup';
    const station = view.stations.find(row => row.id === stationId);
    const job = station?.jobs?.find(row => row && !row.complete);
    const presented = job ? { ...view, stations: view.stations.map(row => row === station ? { ...row, jobs: [job] } : row) } : view;
    super.belt(node, presented);
  }

  transitCup(rect, transform, node, job) {
    if (this.generation === 1) return super.transitCup(rect, transform);
    const receipt = node.id === 'outfeed' ? this.delivery?.amount : job?.amount;
    // One bounded marker represents an existing batch or an already settled
    // receipt. A receipt may aggregate several batches; it is never new stock.
    const amount = receipt >= 4 ? 4 : receipt >= 2 ? 2 : 1;
    if (amount === 1) return this.cupAt(rect, transform);
    this.packageAt([rect[0] - 4, rect[1] - 6, 20, 24], transform, amount, 1, node.id === 'outfeed');
  }
}

module.exports = { SixGenerationScene };
