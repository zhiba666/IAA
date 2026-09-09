'use strict';

// Original, procedural sound effects. No downloads or third-party audio assets.
// Native runtimes without Web Audio safely remain silent; gameplay does not depend on sound.
class AudioEngine {
  constructor() {
    this.enabled = true;
    this.context = null;
    this.lastClick = -Infinity;
    this.lastShip = -Infinity;
    this.voices = 0;
    this.unavailable = false;
    this.native = typeof tt !== 'undefined' && typeof tt.createInnerAudioContext === 'function' ? tt : null;
    this.nativeSounds = {};
    this.lastNativeShip = -Infinity;
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
    if (!this.enabled || !['machine', 'upgrade', 'ship', 'error', 'click'].includes(name)) return;
    if (this.native) { this.playNative(name); return; }
    this.unlock();
    const context = this.context;
    if (!context || context.state === 'suspended' || context.state === 'closed' || this.voices > 18) return;
    const now = context.currentTime;
    if (name === 'ship') {
      if (now - this.lastShip < .65) return;
      this.lastShip = now;
      // A quiet dispatch tick accompanies a group of real shipment events.
      this.tone(680, 940, .075, .018, 'sine', 0);
    } else if (name === 'click') {
      if (now - this.lastClick < 0.035) return;
      this.lastClick = now;
      this.tone(640 + Math.random() * 240, 140, 0.085, 0.07, 'triangle', 0);
    } else if (name === 'machine') {
      // A low installation beat resolves into the first complete batch at 0.8 s.
      this.tone(180, 100, .13, .04, 'triangle', 0);
      this.tone(220, 120, .13, .04, 'triangle', .18);
      this.tone(80, 190, .32, .035, 'sine', .28);
      [440, 554, 659, 880].forEach((frequency, index) => this.tone(frequency, frequency, .23, .055, 'sine', .8 + index * .09));
    } else if (name === 'upgrade') {
      [440, 554, 659, 880].forEach((frequency, index) => this.tone(frequency, frequency, 0.17, 0.06, 'sine', index * 0.075));
    } else if (name === 'error') {
      this.tone(160, 120, 0.13, 0.035, 'triangle', 0);
    }
  }

  playNative(name) {
    // Bundled WAVs, reused contexts; official native API supports package-local paths.
    // https://developer.open-douyin.com/docs/resource/zh-CN/mini-game/develop/guide/basic-function/audio
    const key = name;
    if (key==='ship' && Date.now()-this.lastNativeShip<650) return;
    if (key==='ship') this.lastNativeShip=Date.now();
    try {
      if (!this.nativeSounds[key]) {
        const audio=this.native.createInnerAudioContext();
        audio.src='audio/'+(key==='ship'?'click':key)+'.wav';audio.loop=false;audio.volume=key==='ship'?.12:.45;audio.obeyMuteSwitch=true;
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
