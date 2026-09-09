'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.resolve(__dirname,'../src/audio.js'),'utf8');
function engine(context = {}) {
  const sandbox = vm.createContext({ module: { exports: {} }, ...context });
  vm.runInContext(source,sandbox);
  return new sandbox.module.exports.AudioEngine();
}

test('unsupported and failing audio APIs degrade without affecting gameplay', () => {
  const audio = engine();
  for (const name of ['pop','upgrade','machine','error']) assert.doesNotThrow(() => audio.play(name));
  const native = engine({ tt: { createInnerAudioContext() { throw new Error('unsupported audio'); } } });
  assert.doesNotThrow(() => native.play('upgrade'));
  const brokenWeb = engine({ AudioContext: class { constructor() { throw new Error('no audio device'); } } });
  assert.doesNotThrow(() => brokenWeb.unlock()); assert.doesNotThrow(() => brokenWeb.play('upgrade'));
});

test('native package-local WAV audio is reused and stops when sound is disabled', () => {
  const sounds = [];
  const audio = engine({ tt: { createInnerAudioContext() { const item={ plays:0,stops:0,onError(){},play(){this.plays++;},stop(){this.stops++;} }; sounds.push(item);return item; } } });
  audio.play('upgrade'); audio.play('upgrade');
  assert.equal(sounds.length,1); assert.equal(sounds[0].src,'audio/upgrade.wav');
  assert.equal(sounds[0].plays,2); assert.equal(sounds[0].obeyMuteSwitch,true);
  audio.setEnabled(false); const stopped=sounds[0].stops; audio.play('upgrade');
  assert.equal(sounds[0].plays,2); assert.ok(stopped>=3);
  audio.setEnabled(true); audio.play('machine'); assert.equal(sounds.length,2);
});
