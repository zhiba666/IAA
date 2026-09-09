'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const source = fs.readFileSync(path.resolve(__dirname,'../src/audio.js'),'utf8');
function engine(context = {}) {
  const sandbox = vm.createContext({ module: { exports: {} }, ...context });
  vm.runInContext(source,sandbox);
  return new sandbox.module.exports.AudioEngine();
}

test('unsupported and failing audio APIs degrade without affecting gameplay', () => {
  const audio = engine();
  for (const name of ['click','upgrade','machine','error','ship']) assert.doesNotThrow(() => audio.play(name));
  const native = engine({ tt: { createInnerAudioContext() { throw new Error('unsupported audio'); } } });
  assert.doesNotThrow(() => native.play('upgrade'));
  assert.doesNotThrow(() => native.play('ship'));
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

test('native shipment chimes reuse bundled click sound at low volume with a 650ms limit', () => {
  let now = 1000;
  const sounds = [];
  const audio = engine({ Date: class extends Date { static now() { return now; } },
    tt: { createInnerAudioContext() { const item = { plays: 0, stops: 0, onError() {},
      play() { this.plays++; }, stop() { this.stops++; } }; sounds.push(item); return item; } } });
  audio.play('ship');
  for (let i = 0; i < 10; i++) audio.play('ship');
  assert.equal(sounds.length, 1);
  assert.equal(sounds[0].src, 'audio/click.wav');
  assert.equal(sounds[0].volume, .12);
  assert.equal(sounds[0].plays, 1);
  now += 649; audio.play('ship'); assert.equal(sounds[0].plays, 1);
  now += 1; audio.play('ship'); assert.equal(sounds[0].plays, 2);
  assert.equal(sounds.length, 1, 'the native audio context is reused');
  audio.setEnabled(false); now += 1000; audio.play('ship');
  assert.equal(sounds[0].plays, 2);
});

test('web shipment chime is short, quiet, rate limited, and obeys mute', () => {
  const audio = engine(), tones = [];
  audio.context = { state: 'running', currentTime: 2 };
  audio.tone = (...args) => tones.push(args);
  audio.play('ship'); audio.play('ship');
  assert.equal(tones.length, 1);
  assert.ok(tones[0][2] < .1);
  assert.ok(tones[0][3] < .025);
  audio.context.currentTime += .64; audio.play('ship'); assert.equal(tones.length, 1);
  audio.context.currentTime += .02; audio.play('ship'); assert.equal(tones.length, 2);
  audio.setEnabled(false); audio.context.currentTime += 1; audio.play('ship');
  assert.equal(tones.length, 2);
});

test('retired cues and aliases stay silent without allocating audio contexts', () => {
  let created = 0;
  for (const context of [
    { AudioContext: class { constructor() { created++; } } },
    { tt: { createInnerAudioContext() { created++; return { stop() {}, play() {} }; } } }
  ]) {
    const audio = engine(context);
    for (const name of ['pop', 'tap', 'burst', 'boom', 'unlock', 'order', 'reward', 'coin', 'success', 'complete', 'win', 'deny', 'offline']) audio.play(name);
  }
  assert.equal(created, 0);
});

test('web clicks retain their volume and 35ms limit', () => {
  const audio = engine(), tones = [];
  audio.context = { state: 'running', currentTime: 2 };
  audio.tone = (...args) => tones.push(args);
  audio.play('click'); audio.play('click');
  assert.equal(tones.length, 1);
  assert.equal(tones[0][3], .07);
  audio.context.currentTime += .034; audio.play('click'); assert.equal(tones.length, 1);
  audio.context.currentTime += .002; audio.play('click'); assert.equal(tones.length, 2);
});

test('audio regeneration removes retired WAVs and preserves unrelated files', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'popcorn-audio-'));
  t.after(() => {
    const resolved = fs.realpathSync(directory);
    assert.equal(path.dirname(resolved), fs.realpathSync(os.tmpdir()));
    assert.ok(path.basename(resolved).startsWith('popcorn-audio-'));
    fs.rmSync(resolved, { recursive: true, force: true });
  });
  for (const name of ['heatReady', 'pop', 'burst', 'order', 'complete']) fs.writeFileSync(path.join(directory, name + '.wav'), 'old audio');
  fs.writeFileSync(path.join(directory, 'unrelated.txt'), 'keep');
  const { generateAudio } = await import('../tools/audio.mjs');
  await generateAudio(directory);
  await generateAudio(directory);
  assert.deepEqual(fs.readdirSync(directory).sort(), ['click.wav', 'error.wav', 'machine.wav', 'unrelated.txt', 'upgrade.wav']);
  assert.equal(fs.readFileSync(path.join(directory, 'unrelated.txt'), 'utf8'), 'keep');
  for (const name of ['click', 'error', 'machine', 'upgrade']) {
    const bytes = fs.readFileSync(path.join(directory, name + '.wav'));
    assert.equal(bytes.toString('ascii', 0, 4), 'RIFF');
    assert.equal(bytes.toString('ascii', 8, 12), 'WAVE');
    assert.equal(bytes.readUInt32LE(4) + 8, bytes.length);
    assert.ok(bytes.length > 44);
  }
});
