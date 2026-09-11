const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { createHash } = require('node:crypto');

const tool = import('../tools/six-gen-acceptance.mjs');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const inputFrom = html => JSON.parse(html.match(/globalThis\.__IAA_SIX_ACCEPTANCE_INPUT__=(.*?);<\/script>/s)[1]);

test('v1.1 acceptance lists all four viewports and preserves legacy queries', async () => {
  const { ACCEPTANCE_VIEWPORTS, createSixGenerationFixtures, createSixGenerationAcceptanceServer } = await tool;
  const expected = [{ width: 320, height: 524 }, { width: 360, height: 640 }, { width: 390, height: 844 }, { width: 430, height: 932 }];
  assert.deepEqual(ACCEPTANCE_VIEWPORTS, expected);
  const fixtures = createSixGenerationFixtures();
  assert.equal(fixtures.acceptanceVersion, 'v1.1');
  assert.deepEqual(fixtures.viewports, expected);
  const server = await createSixGenerationAcceptanceServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  try {
    for (const { width, height } of expected) {
      const html = await (await fetch(base + '/?fixture=g1-entry&width=' + width + '&safe=24&pause=0&fail=1')).text();
      assert.ok(html.includes('width="' + width + '" height="' + height + '"'));
      assert.ok(html.includes('src="/game?fixture=g1-entry&safe=24&pause=0&fail=1"'));
      assert.ok(html.includes('<title>v1.1 六代正式运行验收</title>'));
      assert.ok(html.includes('<button data-action="advance">推进 0.5 秒</button>'));
      for (const size of expected) assert.ok(html.includes('>' + size.width + ' × ' + size.height + '</option>'));
      assert.ok(html.includes('value="' + width + '" selected'));
    }
    const fallback = await (await fetch(base + '/?width=unknown')).text();
    assert.ok(fallback.includes('width="390" height="844"'));
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});

test('each fixture rereads the bundle and captures the loaded bytes and actual runtime version', async () => {
  const { createSixGenerationAcceptanceServer } = await tool;
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'v11-acceptance-'));
  const webRoot = path.join(directory, 'web'), output = path.join(directory, 'captures');
  await fs.mkdir(webRoot);
  await fs.writeFile(path.join(webRoot, 'index.html'), '<!doctype html><script src="game.bundle.js"></script>');
  const first = 'globalThis.__POPCORN__={version:"1.1.0"};', second = first + '\n// rebuilt';
  await fs.writeFile(path.join(webRoot, 'game.bundle.js'), first);
  const server = await createSixGenerationAcceptanceServer({ webRoot, output });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  try {
    const html = await (await fetch(base + '/game?fixture=g1-entry&safe=8&pause=0')).text();
    const input = inputFrom(html);
    assert.equal(input.acceptanceVersion, 'v1.1');
    assert.equal(input.bundleSha256, sha(first));
    assert.equal(input.bundleBytes, Buffer.byteLength(first));
    assert.ok(Number.isFinite(Date.parse(input.bundleReadAt)));
    assert.equal(input.safe, 8);
    assert.equal(input.paused, false);
    const originalUrl = base + '/game.bundle.js?__acceptance_sha=' + input.bundleSha256;
    assert.ok(html.includes('src="game.bundle.js?__acceptance_sha=' + sha(first) + '"'));

    // A rebuild after HTML was served must not silently substitute different
    // script bytes; the next fixture must nevertheless read that new build.
    await fs.writeFile(path.join(webRoot, 'game.bundle.js'), second);
    assert.equal(await (await fetch(originalUrl)).text(), first);
    const next = inputFrom(await (await fetch(base + '/game?fixture=g2-entry')).text());
    assert.equal(next.bundleSha256, sha(second));
    assert.notEqual(next.bundleSha256, input.bundleSha256);
    assert.equal(await (await fetch(base + '/game.bundle.js?__acceptance_sha=' + next.bundleSha256)).text(), second);
    assert.equal((await fetch(base + '/game.bundle.js?__acceptance_sha=missing')).status, 410);

    const runtime = await (await fetch(base + '/__six/runtime.js')).text();
    const handlers = {}, messages = [];
    const context = vm.createContext({
      __IAA_SIX_ACCEPTANCE_INPUT__: next,
      // Deliberately differs from the target to prove the checker reads the
      // running app instead of asserting an expected or git-derived version.
      __POPCORN__: { version: '9.8.7-test', snapshot: () => ({ marker: 'actual' }), presentation: () => ({}) },
      location: { hostname: '127.0.0.1', origin: base },
      localStorage: { setItem() {} },
      document: { documentElement: { style: { setProperty() {} } } },
      requestAnimationFrame() {},
      window: { addEventListener(name, fn) { handlers[name] = fn; } },
      parent: { postMessage(message) { messages.push(message); } },
      performance: { getEntriesByType: () => [] }, innerWidth: 360, innerHeight: 640
    });
    vm.runInContext(runtime, context);
    handlers.load();
    const diagnostics = messages[0].diagnostics;
    assert.equal(diagnostics.runtimeVersion, '9.8.7-test');
    assert.equal(diagnostics.bundleSha256, sha(second));
    assert.equal(diagnostics.acceptanceVersion, 'v1.1');
    assert.equal(diagnostics.checkerVersion, 2);
    assert.equal(diagnostics.deviceStatus, 'NOT_RUN');
    assert.equal(diagnostics.snapshot.marker, 'actual');

    const command = action => handlers.message({ origin: base, source: context.parent, data: { type: 'six-gen-command', action } });
    command('advance');
    assert.equal(messages.at(-1).diagnostics.qaClockMs, 500);
    assert.equal(messages.at(-1).diagnostics.paused, true);
    command('step');
    assert.equal(messages.at(-1).diagnostics.qaClockMs, 500 + 1000 / 120);
    command('pause');
    command('advance');
    assert.equal(messages.at(-1).diagnostics.qaClockMs, 500 + 1000 / 120, 'advance cannot change a running QA clock');
    assert.equal(messages.at(-1).diagnostics.paused, false);

    const response = await fetch(base + '/__six/capture/build.json', {
      method: 'POST', headers: { Origin: base, 'X-IAA-Acceptance': 'runtime' }, body: JSON.stringify(diagnostics)
    });
    assert.equal(response.status, 201);
    assert.equal((await response.json()).saved, path.join(output, 'build.json'));
    assert.equal(JSON.parse(await fs.readFile(path.join(output, 'build.json'), 'utf8')).bundleSha256, sha(second));
    assert.equal(JSON.parse(await fs.readFile(path.join(output, 'request-report.json'), 'utf8')).acceptanceVersion, 'v1.1');
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    // Only remove the exact temporary directory created by this test.
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(directory).startsWith('v11-acceptance-'));
    await fs.rm(directory, { recursive: true, force: true });
  }
});
