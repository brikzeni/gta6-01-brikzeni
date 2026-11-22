// Procedural WebAudio: no audio files, everything is synthesized. Created lazily on the
// first user gesture so browsers allow it; every call is safe before that (no-ops).
export function createSoundManager() {
  let ctx = null, master = null, engineOsc = null, engineGain = null, windSrc = null;
  let sirenOn = false, sirenTimer = 0, sirenHi = false;
  function ensure() {
    if (ctx) return true;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.42;
      master.connect(ctx.destination);
      return true;
    } catch { return false; }
  }
  function noiseBuffer(dur) {
    const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * dur), ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }
  function blip(freq, dur, type, vol, slideTo) {
    if (!ensure()) return;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(freq, ctx.currentTime);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, ctx.currentTime + dur);
    g.gain.setValueAtTime(vol || 0.2, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
    o.connect(g); g.connect(master);
    o.start(); o.stop(ctx.currentTime + dur + 0.02);
  }
  function noiseHit(dur, vol, filterFreq) {
    if (!ensure()) return;
    const s = ctx.createBufferSource();
    s.buffer = noiseBuffer(dur);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = filterFreq || 1200;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol || 0.3, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
    s.connect(f); f.connect(g); g.connect(master);
    s.start();
  }
  return {
    unlock() { if (ensure() && ctx.state === 'suspended') ctx.resume(); this.startWind(); },
    startWind() {
      if (!ensure() || windSrc) return;
      try {
        windSrc = ctx.createBufferSource();
        windSrc.buffer = noiseBuffer(2); windSrc.loop = true;
        const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 320;
        const g = ctx.createGain(); g.gain.value = 0.05;
        windSrc.connect(f); f.connect(g); g.connect(master);
        windSrc.start();
      } catch { /* audio is cosmetic */ }
    },
    step() { noiseHit(0.07, 0.12, 900); },
    gunshot() { noiseHit(0.16, 0.5, 2600); blip(160, 0.09, 'square', 0.18, 60); },
    reload() { blip(520, 0.07, 'square', 0.1); setTimeout(() => blip(760, 0.07, 'square', 0.1), 140); },
    pickup() { blip(660, 0.1, 'sine', 0.2); setTimeout(() => blip(990, 0.16, 'sine', 0.2), 90); },
    mission() { [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => blip(f, 0.22, 'triangle', 0.22), i * 110)); },
    fail() { blip(220, 0.4, 'sawtooth', 0.16, 110); },
    hit() { noiseHit(0.08, 0.25, 1800); },
    crash(intensity) { noiseHit(0.3, Math.min(0.6, 0.2 + intensity * 0.4), 500); },
    siren(on) { sirenOn = on; },
    update(dt, speedNorm, inCar) {
      if (!ctx) return;
      if (inCar) {
        if (!engineOsc) {
          engineOsc = ctx.createOscillator(); engineOsc.type = 'sawtooth';
          engineGain = ctx.createGain(); engineGain.gain.value = 0;
          const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 700;
          engineOsc.connect(f); f.connect(engineGain); engineGain.connect(master);
          engineOsc.start();
        }
        engineOsc.frequency.value = 55 + speedNorm * 165;
        engineGain.gain.value = 0.05 + speedNorm * 0.06;
      } else if (engineOsc) {
        engineGain.gain.value = 0;
      }
      if (sirenOn) {
        sirenTimer += dt;
        if (sirenTimer > 0.55) {
          sirenTimer = 0; sirenHi = !sirenHi;
          blip(sirenHi ? 880 : 660, 0.5, 'sine', 0.07);
        }
      }
    },
  };
}
