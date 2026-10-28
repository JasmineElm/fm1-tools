// audio.js — a tiny FM preview so you can HEAR the phrase in the browser, with
// or without the FM-1 attached. Not meant to match the FM-1's engine exactly —
// just enough to hear pitches, rhythm and the parameter changes. Five timbres
// cover the common FM check-list: e-piano (default), bell, bass, organ, square.

let ctx = null;
let master = null;
let comp = null;
let muted = true;   // browser preview starts MUTED: with the FM-1 attached you only want its audio, not the phone speaker
const voices = new Map();   // note -> { oscs: [], gain, rel }

let volume = 70;
try {
  const saved = typeof localStorage !== "undefined" && localStorage ? localStorage.getItem("fm1p.volume") : null;
  if (saved != null) {
    const v = Number(saved);
    if (!isNaN(v) && v >= 0 && v <= 100) volume = v;
  }
} catch (_) {}
const MAX_GAIN = 0.55;

export const SOUNDS = [
  { id: "epiano", name: "e-piano" },
  { id: "bell", name: "bell" },
  { id: "bass", name: "bass" },
  { id: "organ", name: "organ" },
  { id: "chip", name: "square" },
];
let sound = "epiano";
export function setSound(id) { if (SOUNDS.some((s) => s.id === id)) sound = id; }
export function getSound() { return sound; }

// Convert 0..100 UI volume to linear audio gain using a 2.7 power curve (audio taper)
// matching human logarithmic loudness perception.
function volumeToGain(v) {
  if (v <= 0) return 0;
  const norm = Math.max(0, Math.min(100, Number(v) || 0)) / 100;
  return Math.pow(norm, 2.7) * MAX_GAIN;
}

export function getVolume() { return volume; }
export function setVolume(v) {
  volume = Math.max(0, Math.min(100, Number(v) || 0));
  if (master && ctx) {
    const targetGain = muted ? 0 : volumeToGain(volume);
    const t = ctx.currentTime;
    master.gain.cancelScheduledValues(t);
    master.gain.setValueAtTime(master.gain.value, t);
    master.gain.linearRampToValueAtTime(targetGain, t + 0.015);
  }
}

function ensure() {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    try {
      ctx = new AC();
      if (!ctx || typeof ctx.createDynamicsCompressor !== "function") {
        ctx = null;
        return null;
      }
    } catch (_) {
      ctx = null;
      return null;
    }

    // Chords stack up to 9 voices plus release overlap; the compressor keeps
    // the voice sum out of clipping before the master output stage
    comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -12;
    comp.knee.value = 12;
    comp.ratio.value = 4;
    comp.attack.value = 0.004;
    comp.release.value = 0.15;

    // Master volume stage with perceptual audio taper
    master = ctx.createGain();
    master.gain.value = muted ? 0 : volumeToGain(volume);

    // Signal chain: Voices -> Compressor -> Master Output Gain -> Audio Destination
    comp.connect(master);
    master.connect(ctx.destination);
  }
  if (ctx.state === "suspended") ctx.resume();
  return ctx;
}

export function setMuted(m) {
  muted = !!m;
  if (master && ctx) {
    const targetGain = muted ? 0 : volumeToGain(volume);
    const t = ctx.currentTime;
    master.gain.cancelScheduledValues(t);
    master.gain.setValueAtTime(master.gain.value, t);
    master.gain.linearRampToValueAtTime(targetGain, t + 0.01);
  }
}
export function isMuted() { return muted; }
export function unlock() { ensure(); }        // call from a user gesture

const hz = (note) => 440 * Math.pow(2, (note - 69) / 12);

// Each timbre builds its oscillators and its own envelope; all share the same
// gain node + release ramp so noteOff stays uniform.
function buildVoice(c, t, f, vel, id) {
  const gain = c.createGain();
  const v = vel > 0 ? vel / 127 : 1;
  const peak = 0.16 * v;
  const oscs = [];
  const stops = [];

  const osc = (type, freq, g = 1) => {
    const o = c.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    const og = c.createGain();
    og.gain.value = g;
    o.connect(og).connect(gain);
    oscs.push(o);
    return { o, og };
  };
  const fm = (carrier, ratio, depth0, depth1, decayTo) => {
    const { o, og } = osc("sine", carrier.frequency.value * ratio);
    og.gain.setValueAtTime(depth0, t);
    if (depth1 != null) og.gain.exponentialRampToValueAtTime(Math.max(1, depth1), t + decayTo);
    o.connect(og).connect(carrier.frequency);
    return o;
  };

  let rel = 0.09;
  switch (id) {
    case "bell": {
      const { o: c0 } = osc("sine", f);
      fm(c0, 3.01, f * 2.2, f * 0.2, 0.6);
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(peak, t + 0.003);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
      rel = 0.3;
      break;
    }
    case "bass": {
      const { o: c0 } = osc("sine", f);
      fm(c0, 1, f * 4.5, f * 1.1, 0.25);
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(peak * 1.1, t + 0.005);
      gain.gain.linearRampToValueAtTime(peak * 0.65, t + 0.2);
      rel = 0.12;
      break;
    }
    case "organ": {
      osc("sine", f, 1);
      osc("sine", f * 2, 0.38);
      const c0 = oscs[0];
      fm(c0, 1, f * 0.8);
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(peak * 0.7, t + 0.012);
      rel = 0.08;
      break;
    }
    case "chip": {
      osc("square", f);
      const lp = c.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = Math.min(f * 5, 7000);
      gain.connect(lp).connect(comp || master);
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(peak * 0.6, t + 0.004);
      gain.gain.linearRampToValueAtTime(peak * 0.3, t + 0.18);
      rel = 0.05;
      break;
    }
    case "epiano":
    default: {
      const { o: c0 } = osc("sine", f);
      fm(c0, 2, f * 1.2);
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(peak, t + 0.008);
      gain.gain.linearRampToValueAtTime(peak * 0.55, t + 0.35);
      rel = 0.09;
      break;
    }
  }
  if (id !== "chip") gain.connect(comp || master);
  return { oscs, gain, rel };
}

export function noteOn(note, vel = 100) {
  if (muted) return;
  if (typeof note !== "number" || !isFinite(note) || isNaN(note)) return;
  const c = ensure();
  if (!c) return;
  noteOff(note);                              // retrigger cleanly
  const t = c.currentTime;
  const f = hz(note);
  if (typeof f !== "number" || !isFinite(f) || isNaN(f)) return;

  const v = typeof vel === "number" && isFinite(vel) ? vel : 100;
  const voice = buildVoice(c, t, f, v, sound);
  for (const o of voice.oscs) o.start(t);
  voices.set(note, voice);
}

export function noteOff(note) {
  if (typeof note !== "number" || !isFinite(note) || isNaN(note)) return;
  const v = voices.get(note);
  if (!v || !ctx) return;
  const t = ctx.currentTime;
  v.gain.gain.cancelScheduledValues(t);
  v.gain.gain.setValueAtTime(v.gain.gain.value, t);
  v.gain.gain.linearRampToValueAtTime(0, t + v.rel);          // release
  try { for (const o of v.oscs) o.stop(t + v.rel + 0.03); } catch { /* already stopped */ }
  voices.delete(note);
}

export function allOff() { for (const n of [...voices.keys()]) noteOff(n); }
