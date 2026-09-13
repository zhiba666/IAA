'use strict';

// Loaded only by tools/serve-acceptance.mjs before the formal game bundle.
// Browser interaction remains ordinary user/CUA key and pointer input. This
// script never imports Game, mutates its state, or exposes a gameplay shortcut.
(function () {
  const input = globalThis.__IAA_ACCEPTANCE_INPUT__;
  if (!input || !input.fixture || input.scope !== 'first-generation-visual-acceptance') throw new Error('Missing acceptance fixture');
  if (location.hostname !== '127.0.0.1' || location.port !== String(input.port)) throw new Error('Acceptance runtime requires its isolated local origin.');
  if (!['baseline', 'v15'].includes(input.fixture.mode) || input.mode !== input.fixture.mode
    || !input.fixture.storageKey || input.storageKey !== input.fixture.storageKey)
    throw new Error('Acceptance fixture must declare its own matching mode and storage key.');
  // Fixture data retains its historical core mode. The isolated QA URL must
  // explicitly select the compatibility runner before the current bundle
  // reads it; ordinary public ?mode=v15 URLs remain on the main order game.
  const routeMode = input.fixture.mode === 'v15' ? 'legacy-v15' : 'baseline';
  const route = new URL(location.href);
  route.searchParams.set('mode', routeMode);
  history.replaceState(null, '', route.href);
  globalThis.POPCORN_CONFIG = { ...globalThis.POPCORN_CONFIG, mode: routeMode, experiment: null };
  const errors = [], initialSave = JSON.stringify(input.fixture.save);
  // This port has its own storage origin. No production-origin storage is read,
  // removed or migrated, and no native mini-game storage API is involved.
  localStorage.setItem(input.storageKey, initialSave);
  const safeArea = input.safe ? { top: 75, bottom: 40, left: 0, right: 0 } : null;
  if (safeArea) for (const [edge, value] of Object.entries(safeArea)) document.documentElement.style.setProperty('--safe-' + edge, value + 'px', 'important');

  let paused = input.paused, clock = 0, previous = null, recorder = null, recordingName = '', recordTimer = null;
  const nativeFrame = requestAnimationFrame.bind(globalThis);
  globalThis.requestAnimationFrame = function (callback) {
    return nativeFrame(function (now) {
      if (previous !== null && !paused) clock += Math.max(0, now - previous);
      previous = now;
      callback(clock);
    });
  };
  window.addEventListener('error', event => errors.push({ type: 'error', message: event.message || 'resource failed', file: event.filename || event.target?.src || '', at: Date.now() }), true);
  window.addEventListener('unhandledrejection', event => errors.push({ type: 'unhandledrejection', message: String(event.reason), at: Date.now() }));
  const originalError = console.error.bind(console);
  console.error = function (...args) { errors.push({ type: 'console.error', message: args.map(String).join(' '), at: Date.now() }); originalError(...args); };

  function diagnostics() {
    return { capturedAt: new Date().toISOString(), scope: input.scope, fixture: input.fixture.id,
      fixtureKind: input.fixture.kind, fixtureDescription: input.fixture.description,
      mode: input.fixture.mode, storageKey: input.fixture.storageKey, saveVersion: input.fixture.save.version,
      paused, qaClockMs: clock, safeArea,
      viewport: { width: innerWidth, height: innerHeight, devicePixelRatio },
      canvas: (() => { const c = document.querySelector('canvas'); return c ? { width: c.width, height: c.height } : null; })(),
      snapshot: globalThis.__POPCORN__?.snapshot(), presentation: globalThis.__POPCORN__?.presentation?.(),
      errors: errors.slice(), resources: performance.getEntriesByType('resource').map(entry => ({ name: entry.name, initiatorType: entry.initiatorType,
        transferSize: entry.transferSize, encodedBodySize: entry.encodedBodySize, decodedBodySize: entry.decodedBodySize, duration: entry.duration })) };
  }
  function filename(kind) {
    const zones = globalThis.__POPCORN__?.presentation?.()?.zones || [];
    const panel = zones.some(zone => zone.action === 'reviewUpgrade') ? 'collapsed' : zones.some(zone => zone.action === 'collapseStation') ? 'expanded' : 'home';
    return [input.fixture.id, innerWidth + 'x' + innerHeight, input.safe ? 'safe' : 'browser', panel, kind, Date.now()].join('-');
  }
  function title(message) { document.title = '验收 ' + message + ' · 小小爆米花厂'; }
  async function save(name, blob) {
    const result = await fetch('/__acceptance/capture/' + name, { method: 'POST', headers: { 'X-IAA-Acceptance': 'runtime' }, body: blob });
    if (!result.ok) throw new Error('Capture save failed: HTTP ' + result.status);
    return result.json();
  }
  async function snapshotCapture() {
    await new Promise(resolve => nativeFrame(() => nativeFrame(resolve)));
    const canvas = document.querySelector('canvas');
    if (!canvas || !globalThis.__POPCORN__) throw new Error('Formal game has not started');
    const name = filename('still');
    const evidence = diagnostics();
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('Canvas PNG encoding failed');
    const result = await save(name + '.png', blob);
    await save(name + '.json', new Blob([JSON.stringify(evidence, null, 2)], { type: 'application/json' }));
    title('PNG 已保存' + (paused ? ' · 暂停' : ' · 运行'));
    console.info(result.saved);
  }
  async function record() {
    if (recorder) { if (recorder.state !== 'inactive') recorder.stop(); return; }
    const canvas = document.querySelector('canvas');
    if (!canvas || typeof canvas.captureStream !== 'function' || typeof MediaRecorder !== 'function') throw new Error('Canvas recording is unavailable in this browser');
    const stream = canvas.captureStream(30), chunks = [];
    const mime = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find(type => MediaRecorder.isTypeSupported(type));
    if (!mime) throw new Error('WebM recorder is unavailable in this browser');
    recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 2500000 });
    recordingName = filename('motion');
    const name = recordingName, start = diagnostics(), startTime = performance.now();
    recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
    recorder.onerror = event => { console.error(event.error || 'Recording failed'); };
    recorder.onstop = async function () {
      clearTimeout(recordTimer); stream.getTracks().forEach(track => track.stop()); recorder = null;
      try {
        const result = await save(name + '.webm', new Blob(chunks, { type: mime }));
        await save(name + '.json', new Blob([JSON.stringify({ durationMs: performance.now() - startTime, start, end: diagnostics() }, null, 2)], { type: 'application/json' }));
        title('WebM 已保存' + (paused ? ' · 暂停' : ' · 运行')); console.info(result.saved);
      } catch (error) { console.error(error); title('录屏保存失败'); }
    };
    recorder.start(250); recordTimer = setTimeout(() => { if (recorder?.state === 'recording') recorder.stop(); }, 8000);
    title('录屏中 · 最长 8 秒');
  }
  window.addEventListener('keydown', function (event) {
    if (event.repeat || !['KeyP', 'KeyR', 'KeyT', 'Space'].includes(event.code)) return;
    event.preventDefault(); event.stopImmediatePropagation();
    if (event.code === 'Space') { paused = !paused; title(paused ? '暂停' : '运行'); }
    else if (event.code === 'KeyT') { if (paused) { clock += 1000 / 120; title('单步 +1 tick · 暂停'); } }
    else Promise.resolve(event.code === 'KeyP' ? snapshotCapture() : record()).catch(error => { console.error(error); title('捕获失败'); });
  }, true);
  globalThis.__IAA_ACCEPTANCE__ = Object.freeze({ diagnostics });
  title(paused ? '暂停 · P 截图 / R 录屏' : '运行 · P 截图 / R 录屏');
})();
