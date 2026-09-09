'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtemp, mkdir, writeFile, realpath, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const api = import('../tools/bundle.mjs');

async function fixture(t, files) {
  const root = await mkdtemp(path.join(tmpdir(), 'popcorn-bundler-'));
  t.after(async () => {
    const resolved = await realpath(root);
    assert.equal(path.dirname(resolved), await realpath(tmpdir()));
    assert.ok(path.basename(resolved).startsWith('popcorn-bundler-'));
    await rm(resolved, { recursive: true, force: true });
  });
  for (const [name, source] of Object.entries(files)) {
    const filename = path.join(root, name);
    await mkdir(path.dirname(filename), { recursive: true });
    await writeFile(filename, source);
  }
  return root;
}

test('bundler preserves shared exports, circular dependencies and one-time module execution', async t => {
  const root = await fixture(t, {
    'src/main.js': "const a=require('./a');const b=require('./b.cjs');globalThis.result=[a.peer,b.peer,require('./a')===a,globalThis.loads];",
    'src/a.js': "exports.name='a';exports.peer=require('./b.cjs').name;globalThis.loads=(globalThis.loads||0)+1;",
    'src/b.cjs': "exports.name='b';exports.peer=require('./a').name;globalThis.loads=(globalThis.loads||0)+1;"
  });
  const { bundleCommonJS } = await api;
  const { code } = await bundleCommonJS({ root, entries: ['src/main.js'] });
  const context = vm.createContext({});
  vm.runInContext(code, context);
  assert.deepEqual(Array.from(context.result), ['b', 'a', true, 2]);
});

test('bundler rejects forbidden modules and dependencies outside the project', async t => {
  const root = await fixture(t, {
    'src/main.js': "module.exports=require('./blocked');",
    'src/escape.js': "module.exports=require('../../outside');"
  });
  const { bundleCommonJS } = await api;
  const allowModule = id => id !== 'src/blocked.js';
  for (const entry of ['src/blocked.js', 'src/main.js']) {
    await assert.rejects(bundleCommonJS({ root, entries: [entry], allowModule }), /Module not allowed/);
  }
  await assert.rejects(bundleCommonJS({ root, entries: ['src/escape.js'] }), /Dependency outside project/);
});
