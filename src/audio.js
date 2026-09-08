'use strict';

// Original, procedural sound effects. No downloads or third-party audio assets.
// Native runtimes without Web Audio safely remain silent; gameplay does not depend on sound.
class AudioEngine {
  constructor() {
    this.enabled = true;
    this.context = null;
    this.lastPop = -Infinity;
    this.voices = 0;
    this.unavailable = false;
    this.native = typeof tt !== 'undefined' && typeof tt.createInnerAudioContext === 'function' ? tt : null;
    this.nativeSounds = {};
    this.lastNativePop = 0;
  }

  setEnabled(enabled) {
    this.enabled = !!enabled;
    if (!this.enabled) for (const audio of Object.values(this.nativeSounds)) { try { audio.stop(); } catch (_) {} }
    if (!this.enabled && this.context && typeof this.context.suspend === 'function') {
      try { Promise.resolve(this.context.suspend()).catch(function () {}); } catch (_) {}
    }
  }

  unlock() {
    if (this.native) return;
    if (!this.enabled || this.unavailable) return;
    try {
      if (!this.context) {
        const root = typeof globalThis !== 'undefined' ? globalThis : {};
        const Context = root.AudioContext || root.webkitAudioContext;
        if (!Context) { this.unavailable = true; return; }
        this.context = new Context();
      }
      if (this.context.state === 'suspended' && typeof this.context.resume === 'function') {
        Promise.resolve(this.context.resume()).catch(function () {});
      }
    } catch (_) { this.unavailable = true; }
  }

  play(name) {
    if (!this.enabled) return;
    if (this.native) { this.playNative(name); return; }
    this.unlock();
    const context = this.context;
    if (!context || context.state === 'suspended' || context.state === 'closed' || this.voices > 18) return;
    const now = context.currentTime;
    if (name === 'pop' || name === 'tap' || name === 'click') {
      if (now - this.lastPop < 0.035) return;
      this.lastPop = now;
      this.tone(640 + Math.random() * 240, 140, 0.085, 0.07, 'triangle', 0);
    } else if (name === 'heatReady') {
      this.tone(880, 1047, .09, .035, 'sine', 0);
      this.tone(1175, 1175, .1, .03, 'sine', .09);
    } else if (name === 'burst' || name === 'boom') {
      // Short pressure rise, scattered pops, then the higher notes of a filled bucket.
      this.tone(120, 290, 0.085, 0.035, 'sine', 0);
      for (let index = 0; index < 7; index++) this.tone(300 + index * 80, 100, 0.12, 0.05, 'triangle', .07 + index * .035);
      this.tone(190, 85, 0.28, 0.07, 'sine', .065);
      this.tone(880, 880, .13, .045, 'sine', .38);
      this.tone(1047, 1047, .15, .045, 'sine', .45);
    } else if (name === 'machine') {
      // Installation, motor start and first shipment follow the scene's 0.68 s reveal.
      this.tone(180, 100, .13, .04, 'triangle', 0);
      this.tone(220, 120, .13, .04, 'triangle', .18);
      this.tone(80, 190, .32, .035, 'sine', .28);
      [440, 554, 659, 880].forEach((frequency, index) => this.tone(frequency, frequency, .19, .055, 'sine', .66 + index * .075));
    } else if (name === 'upgrade' || name === 'unlock') {
      [440, 554, 659, 880].forEach((frequency, index) => this.tone(frequency, frequency, 0.17, 0.06, 'sine', index * 0.075));
    } else if (name === 'order' || name === 'reward' || name === 'coin' || name === 'success') {
      [659, 880, 1047].forEach((frequency, index) => this.tone(frequency, frequency * 1.04, 0.13, 0.055, 'sine', index * 0.075));
    } else if (name === 'complete' || name === 'win') {
      [523, 659, 784, 1047, 784, 1047].forEach((frequency, index) => this.tone(frequency, frequency, 0.22, 0.06, 'sine', index * 0.12));
    } else if (name === 'error' || name === 'deny') {
      this.tone(160, 120, 0.13, 0.035, 'triangle', 0);
    } else {
      this.tone(440, 390, 0.05, 0.025, 'sine', 0);
    }
  }

  playNative(name) {
    // Bundled WAVs, reused contexts; official native API supports package-local paths.
    // https://developer.open-douyin.com/docs/resource/zh-CN/mini-game/develop/guide/basic-function/audio
    const aliases = { tap:'pop', boom:'burst', unlock:'upgrade', machine:'upgrade', reward:'order', coin:'order', success:'order', win:'complete', deny:'error', offline:'order' };
    const key = aliases[name] || (['pop','burst','upgrade','order','complete','error','heatReady'].includes(name)?name:'click');
    if (key==='pop' && Date.now()-this.lastNativePop<90) return;
    if (key==='pop') this.lastNativePop=Date.now();
    try {
      if (!this.nativeSounds[key]) {
        const audio=this.native.createInnerAudioContext();
        audio.src='audio/'+key+'.wav';audio.loop=false;audio.volume=.45;audio.obeyMuteSwitch=true;
        if(typeof audio.onError==='function')audio.onError(()=>{});
        this.nativeSounds[key]=audio;
      }
      const audio=this.nativeSounds[key];audio.stop();audio.play();
    } catch (_) { /* Unsupported native audio safely degrades without interrupting play. */ }
  }

  tone(frequency, endFrequency, duration, volume, type, delay) {
    const context = this.context;
    if (!context || this.voices >= 20) return;
    try {
      const start = context.currentTime + delay;
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = type;
      oscillator.frequency.setValueAtTime(frequency, start);
      oscillator.frequency.exponentialRampToValueAtTime(Math.max(20, endFrequency), start + duration);
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(volume, start + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
      oscillator.connect(gain);
      gain.connect(context.destination);
      this.voices++;
      oscillator.onended = () => {
        this.voices = Math.max(0, this.voices - 1);
        try { oscillator.disconnect(); gain.disconnect(); } catch (_) {}
      };
      oscillator.start(start);
      oscillator.stop(start + duration + 0.02);
    } catch (_) { /* unsupported Web Audio nodes degrade without affecting the game */ }
  }
}

module.exports = { AudioEngine: AudioEngine };
