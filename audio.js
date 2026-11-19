/* 蒼穹創意科技工作坊｜BGM 與音效（Web Audio 即時合成，不載入音檔） */
(function () {
'use strict';
let ctx = null, master, bgmBus, sfxBus, verb, on = false, bgmTimer = null, nextBar = 0, bar = 0, duck = 1;
const KEY = 'aetheris-sound';

function init() {
  if (ctx) return;
  const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
  ctx = new AC();
  master = ctx.createGain(); master.gain.value = 0; master.connect(ctx.destination);
  bgmBus = ctx.createGain(); bgmBus.gain.value = 0.55;
  sfxBus = ctx.createGain(); sfxBus.gain.value = 0.7;
  // soft room reverb from a decaying noise impulse
  verb = ctx.createConvolver();
  const len = ctx.sampleRate * 3.2, ir = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) { const d = ir.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2); }
  verb.buffer = ir;
  const wet = ctx.createGain(); wet.gain.value = 0.5; verb.connect(wet); wet.connect(master);
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2600;
  bgmBus.connect(lp); lp.connect(master); lp.connect(verb);
  sfxBus.connect(master); sfxBus.connect(verb);
}

const hz = m => 440 * Math.pow(2, (m - 69) / 12);
function tone(t, midi, dur, { type = 'sine', gain = 0.1, attack = 0.02, bus = sfxBus, detune = 0 } = {}) {
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type; o.frequency.value = hz(midi); o.detune.value = detune;
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g); g.connect(bus); o.start(t); o.stop(t + dur + 0.05);
}
function noise(t, dur, { gain = 0.2, f0 = 400, f1 = 2400, q = 1, type = 'bandpass', bus = sfxBus } = {}) {
  const n = ctx.createBufferSource(), len = Math.ceil(ctx.sampleRate * dur), b = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = b.getChannelData(0); for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  n.buffer = b;
  const f = ctx.createBiquadFilter(); f.type = type; f.Q.value = q; f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(f1, t + dur);
  const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + dur * 0.4); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  n.connect(f); f.connect(g); g.connect(bus); n.start(t); n.stop(t + dur);
}

/* ---- BGM: slow ambient chords in D major with sparse pentatonic bells ---- */
const CHORDS = [[50, 57, 62, 66, 69], [47, 54, 59, 62, 66], [43, 50, 57, 59, 66], [45, 52, 57, 61, 64]]; // Dmaj9, Bm7, Gmaj9, A6
const BELLS = [74, 76, 78, 81, 83, 86];
const BAR = 6.4;
function scheduleBar(t) {
  const ch = CHORDS[bar % CHORDS.length];
  ch.forEach((m, k) => {
    tone(t, m, BAR + 1.6, { type: k ? 'triangle' : 'sine', gain: k ? 0.022 : 0.04, attack: 2.2, bus: bgmBus, detune: (k % 2 ? 4 : -4) });
    if (k) tone(t, m + 12, BAR, { type: 'sine', gain: 0.008, attack: 2.8, bus: bgmBus, detune: 7 });
  });
  const n = 2 + ((bar * 7) % 3);
  for (let i = 0; i < n; i++) {
    const at = t + 0.6 + i * (BAR / n) + Math.random() * 0.4;
    tone(at, BELLS[(bar * 3 + i * 2 + ((Math.random() * 3) | 0)) % BELLS.length], 3.2, { type: 'sine', gain: 0.03, attack: 0.005, bus: bgmBus });
  }
  bar++;
}
function bgmLoop() {
  if (!ctx) return;
  while (nextBar < ctx.currentTime + 1.5) { scheduleBar(nextBar); nextBar += BAR; }
}

/* ---- sound effects ---- */
const FX = {
  whoosh(t) { noise(t, 0.9, { gain: 0.16, f0: 300, f1: 2800, q: 0.8 }); },
  arrive(t) { tone(t, 81, 1.4, { gain: 0.07 }); tone(t + 0.09, 88, 1.6, { gain: 0.05 }); },
  click(t) { tone(t, 84, 0.12, { type: 'triangle', gain: 0.05, attack: 0.002 }); },
  tab(t) { tone(t, 79, 0.18, { gain: 0.05, attack: 0.003 }); tone(t + 0.05, 86, 0.22, { gain: 0.04, attack: 0.003 }); },
  open(t) { [74, 78, 81, 86].forEach((m, i) => tone(t + i * 0.07, m, 1.2, { gain: 0.05, attack: 0.004 })); },
  close(t) { [86, 81, 74].forEach((m, i) => tone(t + i * 0.06, m, 0.8, { gain: 0.04, attack: 0.004 })); },
  move(t) { tone(t, 64, 0.09, { type: 'square', gain: 0.025, attack: 0.002 }); noise(t, 0.06, { gain: 0.08, f0: 1800, f1: 900, q: 2 }); },
  clash(t) { noise(t, 0.35, { gain: 0.25, f0: 900, f1: 180, q: 0.7, type: 'lowpass' }); tone(t, 45, 0.3, { type: 'triangle', gain: 0.12, attack: 0.003 }); },
  boom(t) { noise(t, 0.9, { gain: 0.4, f0: 1200, f1: 60, q: 0.5, type: 'lowpass' }); tone(t, 33, 0.8, { type: 'sine', gain: 0.25, attack: 0.004 }); },
  win(t) { [62, 66, 69, 74, 78, 81].forEach((m, i) => tone(t + i * 0.11, m, 1.8, { type: 'triangle', gain: 0.06, attack: 0.01 })); },
};
function play(name) {
  if (!on || !ctx || !FX[name]) return;
  FX[name](ctx.currentTime + 0.01);
}

function setDuck(v) { duck = v; if (ctx) bgmBus.gain.setTargetAtTime(0.55 * v, ctx.currentTime, 0.4); }
function setOn(v) {
  init(); if (!ctx) return false;
  on = v;
  if (on) {
    ctx.resume();
    master.gain.setTargetAtTime(0.9, ctx.currentTime, 0.6);
    nextBar = Math.max(nextBar, ctx.currentTime + 0.1);
    clearInterval(bgmTimer); bgmTimer = setInterval(bgmLoop, 500); bgmLoop();
  } else {
    master.gain.setTargetAtTime(0, ctx.currentTime, 0.25);
    clearInterval(bgmTimer); bgmTimer = null;
    setTimeout(() => { if (!on && ctx) ctx.suspend(); }, 900);
  }
  try { localStorage.setItem(KEY, on ? '1' : '0'); } catch (e) {}
  return on;
}
// lower the music while a video is playing
document.addEventListener('play', e => { if (e.target.tagName === 'VIDEO') setDuck(0); }, true);
document.addEventListener('pause', e => { if (e.target.tagName === 'VIDEO') setDuck(1); }, true);
document.addEventListener('ended', e => { if (e.target.tagName === 'VIDEO') setDuck(1); }, true);
document.addEventListener('visibilitychange', () => { if (!ctx || !on) return; document.hidden ? ctx.suspend() : ctx.resume(); });

let wanted = false; try { wanted = localStorage.getItem(KEY) === '1'; } catch (e) {}
window.SFX = { play, setOn, get on() { return on; }, get wanted() { return wanted; } };
})();
