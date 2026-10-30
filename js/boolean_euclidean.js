// js/boolean_euclidean.js — Boolean Euclidean Logic Sequencer Model
// Multi-stream Euclidean rhythm generators (E(k1, n1), E(k2, n2), etc.) combined via Boolean logic operators
// (XOR, AND, OR, NAND, XNOR, MAJORITY, PARITY). Hit coincidences trigger velocity accents and harmonic octave leaps.

import {
  state, refs, status, doGenerate, RATE_NAMES, setModelGenerator,
  setModelRandomizer
} from "./state.js";
import { panicPreview } from "./player.js";
import { knob, dropdown, toggleBtn, actionBtn } from "./controls.js";
import { getRootMidi, getActiveScaleIntervals, quantize, midiName } from "./scale.js";
import { playVoice, releasePolyVoices, selectPolyVoices } from "./poly.js";
import { euclid } from "./generator.js";
import { registerModel } from "./snapshot.js";
import { getThemePalette } from "./themes.js";
import * as audio from "./audio.js";

export const MAX_STREAMS = 4;
export const MAX_VOICES = 8;

export const STREAM_COLORS = [
  "#00f0ff", // Stream A: Cyan
  "#ff007f", // Stream B: Pink
  "#ffb700", // Stream C: Amber
  "#39ff14"  // Stream D: Lime
];

export const MASTER_COLOR = "#ffffff"; // White for Boolean Master Stream

export const BOOLEAN_OPERATORS = [
  { id: "xor", name: "XOR (Syncopated Cross-Rhythm)" },
  { id: "and", name: "AND (Coincidence Accents)" },
  { id: "or", name: "OR (Union / Dense Skeleton)" },
  { id: "nand", name: "NAND (Inverted Intersection)" },
  { id: "xnor", name: "XNOR (Mutual Hit / Rest)" },
  { id: "diff", name: "DIFF (A and NOT B)" },
  { id: "majority", name: "MAJORITY (Voting ≥ 2 Streams)" },
  { id: "parity", name: "PARITY (Odd Parity A⊕B⊕C⊕D)" }
];

export const BEUCLID_PRESETS = [
  {
    id: "tresillo_coincidence",
    name: "Tresillo Coincidence",
    desc: "E(3, 8) and E(5, 8) combined via XOR syncopation & AND coincidence accents",
    op: "xor",
    streamA: { k: 3, n: 8, rot: 0, degree: 0 },
    streamB: { k: 5, n: 8, rot: 2, degree: 4 },
    streamC: { k: 2, n: 8, rot: 1, degree: 7 },
    streamD: { k: 4, n: 16, rot: 0, degree: 11 },
    boost: 85,
    speed: 1.0,
    gate: 0.70,
    octLeap: 50
  },
  {
    id: "bossa_interlock",
    name: "Bossa Interlock",
    desc: "E(5, 16) and E(7, 16) with Majority voting and syncopated bell chimes",
    op: "majority",
    streamA: { k: 5, n: 16, rot: 0, degree: 0 },
    streamB: { k: 7, n: 16, rot: 3, degree: 5 },
    streamC: { k: 3, n: 16, rot: 6, degree: 7 },
    streamD: { k: 9, n: 16, rot: 1, degree: 12 },
    boost: 70,
    speed: 1.15,
    gate: 0.65,
    octLeap: 40
  },
  {
    id: "afro_bell_12",
    name: "Afro-Cuban 12/8 Bell",
    desc: "E(4, 12) and E(7, 12) polyrhythmic interlocking ternary lead",
    op: "xor",
    streamA: { k: 4, n: 12, rot: 0, degree: 0 },
    streamB: { k: 7, n: 12, rot: 2, degree: 3 },
    streamC: { k: 5, n: 12, rot: 4, degree: 7 },
    streamD: { k: 3, n: 12, rot: 1, degree: 10 },
    boost: 90,
    speed: 1.0,
    gate: 0.75,
    octLeap: 60
  },
  {
    id: "pygmy_polyrhythm",
    name: "Pygmy Polyrhythm",
    desc: "E(7, 16), E(9, 16), and E(11, 24) cross-metric phasing with quad coincidence bursts",
    op: "and",
    streamA: { k: 7, n: 16, rot: 0, degree: 0 },
    streamB: { k: 9, n: 16, rot: 2, degree: 4 },
    streamC: { k: 11, n: 24, rot: 5, degree: 7 },
    streamD: { k: 5, n: 12, rot: 1, degree: 9 },
    boost: 100,
    speed: 1.25,
    gate: 0.80,
    octLeap: 75
  },
  {
    id: "euclid_acid_xor",
    name: "Euclidean Acid XOR",
    desc: "E(5, 8) and E(3, 7) high-speed odd-meter XOR syncopation with octave jumping accents",
    op: "diff",
    streamA: { k: 5, n: 8, rot: 0, degree: 0 },
    streamB: { k: 3, n: 7, rot: 1, degree: 7 },
    streamC: { k: 4, n: 9, rot: 3, degree: 3 },
    streamD: { k: 2, n: 5, rot: 0, degree: 10 },
    boost: 80,
    speed: 1.3,
    gate: 0.60,
    octLeap: 80
  }
];

// Pre-allocated typed memory buffers (Zero GC churn)
export const streamK = new Uint8Array(MAX_STREAMS);
export const streamN = new Uint8Array(MAX_STREAMS);
export const streamRot = new Uint8Array(MAX_STREAMS);
export const streamDegree = new Int8Array(MAX_STREAMS);
export const streamMute = new Uint8Array(MAX_STREAMS); // 0 = active, 1 = muted
export const streamPulse = new Float32Array(MAX_STREAMS);
export const masterPulse = new Float32Array(1);

// Coincidence flash state
export let lastCoincidenceCount = 0;
export let coincidenceFlash = 0.0;
export let simStepCounter = 0;

// Simulation timing
let isSimulationRunning = false;
let animFrameId = null;
let lastTimestamp = 0;
let stepTimer = 0;

// Canvas & UI elements
let canvasEl = null;
let ctx = null;
let hudElement = null;
let containerEl = null;

/**
 * Initializes default streams from preset.
 */
export function initBooleanEuclideanStreams() {
  const p = BEUCLID_PRESETS[0];
  const streams = [p.streamA, p.streamB, p.streamC, p.streamD];
  for (let s = 0; s < MAX_STREAMS; s++) {
    streamK[s] = streams[s].k;
    streamN[s] = streams[s].n;
    streamRot[s] = streams[s].rot;
    streamDegree[s] = streams[s].degree;
    streamMute[s] = 0;
    streamPulse[s] = 0.0;
  }
  masterPulse[0] = 0.0;
  coincidenceFlash = 0.0;
  simStepCounter = 0;
  stepTimer = 0;
}

// Initial initialization
initBooleanEuclideanStreams();

/**
 * Evaluates whether stream `s` has a pulse hit at global clock step `t`.
 */
export function evaluateStreamHit(s, t) {
  if (streamMute[s] === 1) return 0;
  const k = Math.max(1, streamK[s]);
  const n = Math.max(2, streamN[s]);
  const rot = streamRot[s] % n;

  // Compute Euclidean hit directly via modular arithmetic (Bresenham/Bjorklund)
  // Step index within local cycle
  const localStep = (t - rot + n * 1000) % n;
  // Bresenham accumulator hit condition: ((localStep * k) % n) < k
  return (((localStep * k) % n) < k) ? 1 : 0;
}

/**
 * Computes Boolean combination over the stream hits.
 */
export function evaluateBooleanLogic(op, hitA, hitB, hitC, hitD) {
  switch (op) {
    case "and":
      return (hitA && hitB) ? 1 : 0;

    case "or":
      return (hitA || hitB) ? 1 : 0;

    case "nand":
      return !(hitA && hitB) ? 1 : 0;

    case "xnor":
      return (hitA === hitB) ? 1 : 0;

    case "diff":
      return (hitA && !hitB) ? 1 : 0;

    case "majority": {
      const sum = hitA + hitB + hitC + hitD;
      return (sum >= 2) ? 1 : 0;
    }

    case "parity":
      return (hitA ^ hitB ^ hitC ^ hitD) ? 1 : 0;

    case "xor":
    default:
      return (hitA ^ hitB) ? 1 : 0;
  }
}

/**
 * Evaluates a single clock step, returns active polyphonic note events.
 */
export function stepBooleanEuclidean(st = state, isAudioActive = false) {
  const op = st.beuclidOp || "xor";
  const numVoices = Math.max(1, Math.min(MAX_VOICES, st.beuclidVoices || 4));
  const boost = (st.beuclidBoost ?? 80) / 100.0;
  const octLeapProb = (st.beuclidOctLeap ?? 50) / 100.0;
  const gateMult = (st.beuclidGate ?? 70) / 100.0;

  const t = simStepCounter;
  simStepCounter++;

  // 1. Evaluate hits for all 4 Euclidean streams
  const hitA = evaluateStreamHit(0, t);
  const hitB = evaluateStreamHit(1, t);
  const hitC = evaluateStreamHit(2, t);
  const hitD = evaluateStreamHit(3, t);

  // 2. Evaluate Boolean Master Stream
  const masterHit = evaluateBooleanLogic(op, hitA, hitB, hitC, hitD);

  // 3. Compute Coincidence Metric (how many streams fired concurrently)
  const coincidenceCount = hitA + hitB + hitC + hitD;
  lastCoincidenceCount = coincidenceCount;

  if (coincidenceCount >= 2) {
    coincidenceFlash = 1.0;
  }

  // 4. Resolve candidate note events for up to 8 polyphonic voice channels
  const root = getRootMidi();
  const intervals = getActiveScaleIntervals();
  const span = Math.max(1, Math.min(4, st.pitchSpan || 2));

  const candidates = [];

  // Channel 0: Boolean Master Stream (A op B)
  if (masterHit) {
    const deg = 0; // Root degree
    let octShift = 0;
    if (coincidenceCount >= 2 && Math.random() < octLeapProb) {
      octShift = coincidenceCount >= 3 ? 24 : 12;
    }
    const rawMidi = root + deg + octShift;
    const note = quantize(rawMidi, intervals, root);
    const vel = Math.max(40, Math.min(127, Math.round(75 + coincidenceCount * 14 * boost)));
    candidates.push({ voice: 0, note, vel, isCoincidence: coincidenceCount >= 2 });
  }

  // Channel 1: Stream A
  if (hitA) {
    const deg = streamDegree[0];
    const rawMidi = root + deg;
    const note = quantize(rawMidi, intervals, root);
    const vel = Math.max(30, Math.min(127, Math.round(60 + (hitB ? 25 : 0) * boost)));
    candidates.push({ voice: 1, note, vel, isCoincidence: Boolean(hitB) });
  }

  // Channel 2: Stream B
  if (hitB) {
    const deg = streamDegree[1];
    const rawMidi = root + deg;
    const note = quantize(rawMidi, intervals, root);
    const vel = Math.max(30, Math.min(127, Math.round(60 + (hitA ? 25 : 0) * boost)));
    candidates.push({ voice: 2, note, vel, isCoincidence: Boolean(hitA) });
  }

  // Channel 3: Stream C
  if (hitC) {
    const deg = streamDegree[2];
    const rawMidi = root + deg;
    const note = quantize(rawMidi, intervals, root);
    const vel = Math.max(30, Math.min(127, Math.round(55 + (hitD ? 20 : 0) * boost)));
    candidates.push({ voice: 3, note, vel, isCoincidence: Boolean(hitD) });
  }

  // Channel 4: Stream D
  if (hitD) {
    const deg = streamDegree[3];
    const rawMidi = root + deg;
    const note = quantize(rawMidi, intervals, root);
    const vel = Math.max(30, Math.min(127, Math.round(55 + (hitC ? 20 : 0) * boost)));
    candidates.push({ voice: 4, note, vel, isCoincidence: Boolean(hitC) });
  }

  // Channel 5: Dual Coincidence Accent (A and B)
  if (hitA && hitB) {
    const deg = 7; // Perfect 5th / Octave accent
    const rawMidi = root + deg + (coincidenceCount >= 3 ? 12 : 0);
    const note = quantize(rawMidi, intervals, root);
    const vel = Math.max(60, Math.min(127, Math.round(95 + 15 * boost)));
    candidates.push({ voice: 5, note, vel, isCoincidence: true });
  }

  // Channel 6: High Coincidence Accent (C and D)
  if (hitC && hitD) {
    const deg = 12; // Octave accent
    const rawMidi = root + deg;
    const note = quantize(rawMidi, intervals, root);
    const vel = Math.max(60, Math.min(127, Math.round(90 + 15 * boost)));
    candidates.push({ voice: 6, note, vel, isCoincidence: true });
  }

  // Channel 7: Total Quad Eclipse (A and B and C and D)
  if (hitA && hitB && hitC && hitD) {
    const deg = 19; // Octave + Fifth mega accent
    const rawMidi = root + deg;
    const note = quantize(rawMidi, intervals, root);
    const vel = 127; // Maximum velocity fortissimo
    candidates.push({ voice: 7, note, vel, isCoincidence: true });
  }

  // 5. Enforce 8-Voice Polyphony Ceiling
  const selected = selectPolyVoices(candidates, numVoices, st.polyStrategy || "extrema");

  if (isAudioActive && selected.length > 0) {
    const durMs = Math.max(50, Math.min(500, Math.round(150 * gateMult)));
    for (const item of selected) {
      playVoice(item.voice, item.note, item.vel, durMs);
      if (item.voice === 0) masterPulse[0] = 1.0;
      else if (item.voice >= 1 && item.voice <= 4) streamPulse[item.voice - 1] = 1.0;
    }
  }

  return { selected, coincidenceCount, masterHit };
}

/**
 * Real-time simulation integration loop.
 */
export function stepBooleanEuclideanSimulation(dt) {
  if (!isSimulationRunning) return;

  const bpm = Number(state.tempo) || 120;
  const speed = Number(state.beuclidSpeed) || 1.0;
  const stepInterval = (60.0 / (bpm * 4.0)) / Math.max(0.2, speed);

  stepTimer += dt;
  if (stepTimer >= stepInterval) {
    stepTimer %= stepInterval;
    stepBooleanEuclidean(state, true);
  }

  // Decay visual pulses
  masterPulse[0] = Math.max(0.0, masterPulse[0] - dt * 4.0);
  for (let s = 0; s < MAX_STREAMS; s++) {
    streamPulse[s] = Math.max(0.0, streamPulse[s] - dt * 4.0);
  }
  if (coincidenceFlash > 0) {
    coincidenceFlash = Math.max(0.0, coincidenceFlash - dt * 5.0);
  }
}

/**
 * Generator Function Contract: generateBooleanEuclideanBank(state)
 * Deterministically generates a 64-step bank array conforming to FM-1 Pulses standard.
 */
export function generateBooleanEuclideanBank(st = state) {
  const seqLen = Math.max(1, Math.min(64, st.length || 64));
  const rate = RATE_NAMES[st.rate] || "1/16";

  const tempCounter = simStepCounter;
  simStepCounter = 0;

  const steps = [];

  for (let s = 0; s < seqLen; s++) {
    const { selected } = stepBooleanEuclidean(st, false);

    if (selected.length === 0) {
      steps.push({ notes: [] });
    } else {
      const stepNotes = selected.map((item) => ({
        note: item.note,
        vel: item.vel
      }));
      steps.push({ notes: stepNotes });
    }
  }

  simStepCounter = tempCounter;

  return [{
    length: seqLen,
    steps,
    rate
  }];
}

export function isBooleanEuclideanRunning() {
  return isSimulationRunning;
}

export function startBooleanEuclidean() {
  if (isSimulationRunning) return;
  isSimulationRunning = true;
  lastTimestamp = performance.now();
  status("Boolean Euclidean: Running", "ok");
}

export function stopBooleanEuclidean() {
  isSimulationRunning = false;
  releasePolyVoices();
  panicPreview();
  status("Boolean Euclidean: Stopped", "dim");
}

export function toggleBooleanEuclidean() {
  if (isSimulationRunning) {
    stopBooleanEuclidean();
  } else {
    startBooleanEuclidean();
  }
}

/**
 * Applies a curated preset configuration.
 */
export function applyBooleanEuclideanPreset(presetId) {
  const p = BEUCLID_PRESETS.find((item) => item.id === presetId);
  if (!p) return;

  state.beuclidOp = p.op;
  state.beuclidBoost = p.boost;
  state.beuclidSpeed = p.speed;
  state.beuclidGate = Math.round(p.gate * 100);
  state.beuclidOctLeap = p.octLeap;

  const streams = [p.streamA, p.streamB, p.streamC, p.streamD];
  for (let s = 0; s < MAX_STREAMS; s++) {
    streamK[s] = streams[s].k;
    streamN[s] = streams[s].n;
    streamRot[s] = streams[s].rot;
    streamDegree[s] = streams[s].degree;
    streamMute[s] = 0;
  }

  syncControlsFromState();
  doGenerate(true);
  status(`Boolean Euclidean: Preset loaded "${p.name}"`, "ok");
}

/**
 * Randomizes streams and parameters.
 */
export function randomizeBooleanEuclidean() {
  const ops = BOOLEAN_OPERATORS.map((o) => o.id);
  state.beuclidOp = ops[Math.floor(Math.random() * ops.length)];
  state.beuclidBoost = 50 + Math.floor(Math.random() * 51); // 50 to 100
  state.beuclidOctLeap = 20 + Math.floor(Math.random() * 61); // 20 to 80
  state.beuclidSpeed = 0.8 + Math.random() * 0.6; // 0.8 to 1.4
  state.beuclidVoices = 3 + Math.floor(Math.random() * 5); // 3 to 7

  // Randomize Euclidean pulses and lengths
  const lengths = [8, 12, 16, 24];
  for (let s = 0; s < MAX_STREAMS; s++) {
    const n = lengths[Math.floor(Math.random() * lengths.length)];
    const k = 2 + Math.floor(Math.random() * (n - 2));
    streamN[s] = n;
    streamK[s] = k;
    streamRot[s] = Math.floor(Math.random() * n);
    streamDegree[s] = [0, 2, 3, 5, 7, 9, 10, 12][Math.floor(Math.random() * 8)];
  }

  syncControlsFromState();
  doGenerate(true);
  status("Boolean Euclidean: Randomized", "ok");
}

// Snapshot Serialization
registerModel({
  id: "boolean_euclidean",
  version: 1,
  migrations: {},
  capture: () => ({
    streamK: Array.from(streamK),
    streamN: Array.from(streamN),
    streamRot: Array.from(streamRot),
    streamDegree: Array.from(streamDegree),
    streamMute: Array.from(streamMute),
    simStepCounter,
    op: state.beuclidOp ?? "xor",
    voices: state.beuclidVoices ?? 4,
    boost: state.beuclidBoost ?? 80,
    speed: state.beuclidSpeed ?? 1.0,
    gate: state.beuclidGate ?? 70,
    octLeap: state.beuclidOctLeap ?? 50
  }),
  restore: (snap) => {
    if (!snap) return;
    if (Array.isArray(snap.streamK)) streamK.set(snap.streamK);
    if (Array.isArray(snap.streamN)) streamN.set(snap.streamN);
    if (Array.isArray(snap.streamRot)) streamRot.set(snap.streamRot);
    if (Array.isArray(snap.streamDegree)) streamDegree.set(snap.streamDegree);
    if (Array.isArray(snap.streamMute)) streamMute.set(snap.streamMute);
    simStepCounter = snap.simStepCounter ?? 0;

    if (snap.op !== undefined) state.beuclidOp = snap.op;
    if (snap.voices !== undefined) state.beuclidVoices = snap.voices;
    if (snap.boost !== undefined) state.beuclidBoost = snap.boost;
    if (snap.speed !== undefined) state.beuclidSpeed = snap.speed;
    if (snap.gate !== undefined) state.beuclidGate = snap.gate;
    if (snap.octLeap !== undefined) state.beuclidOctLeap = snap.octLeap;

    syncControlsFromState();
    doGenerate(true);
  }
});

/**
 * Animation loop.
 */
function animationTick(now) {
  if (!lastTimestamp) lastTimestamp = now;
  const dt = Math.min(0.1, (now - lastTimestamp) / 1000.0);
  lastTimestamp = now;

  if (isSimulationRunning) {
    stepBooleanEuclideanSimulation(dt);
  }

  renderCanvas();
  animFrameId = requestAnimationFrame(animationTick);
}

/**
 * Canvas renderer obeying strict workbench flat aesthetic rules.
 */
export function renderCanvas() {
  if (!canvasEl || !ctx) return;

  const w = canvasEl.width;
  const h = canvasEl.height;

  // Resolve dynamic semantic tokens
  const { panel: colBg, panel2: colPanel2, line: colLine, lineFocus: colLineFocus, fg: colFg, dim: colDim, accent: colAccent, accent2: colAccent2 } = getThemePalette();

  // Solid background (strictly zero gradients)
  ctx.fillStyle = colBg;
  ctx.fillRect(0, 0, w, h);

  const cx = w / 2;
  const cy = h / 2;
  const maxRadius = Math.min(w, h) * 0.44;

  // 1. Concentric Euclidean Rings:
  // Ring 0 (Outer): Boolean Master Output
  // Ring 1: Stream A
  // Ring 2: Stream B
  // Ring 3: Stream C
  // Ring 4: Stream D
  const ringRadii = [
    maxRadius,
    maxRadius * 0.80,
    maxRadius * 0.62,
    maxRadius * 0.46,
    maxRadius * 0.30
  ];

  // Draw Coincidence Glow in center
  if (coincidenceFlash > 0.05) {
    ctx.fillStyle = colAccent2;
    ctx.globalAlpha = coincidenceFlash * 0.35;
    ctx.beginPath();
    ctx.arc(cx, cy, ringRadii[4] * 0.9, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1.0;
  }

  // Draw base track rings
  ctx.lineWidth = 1;
  for (let r = 0; r < 5; r++) {
    ctx.strokeStyle = (r === 0) ? colLineFocus : colLine;
    ctx.beginPath();
    ctx.arc(cx, cy, ringRadii[r], 0, Math.PI * 2);
    ctx.stroke();
  }

  // Current clock angle: theta = (simStepCounter % 16) / 16 * 2pi
  const masterSteps = 16;
  const playheadAngle = ((simStepCounter % masterSteps) / masterSteps) * Math.PI * 2 - Math.PI / 2;

  // 2. Draw Stream Rings and Pulse Beads
  for (let s = 0; s < MAX_STREAMS; s++) {
    const n = Math.max(2, streamN[s]);
    const k = Math.max(1, streamK[s]);
    const rot = streamRot[s];
    const r = ringRadii[s + 1];
    const streamColor = STREAM_COLORS[s];

    for (let i = 0; i < n; i++) {
      const angle = (i / n) * Math.PI * 2 - Math.PI / 2;
      const bx = cx + Math.cos(angle) * r;
      const by = cy + Math.sin(angle) * r;

      const isHit = evaluateStreamHit(s, i);
      const isCurrentStep = (((simStepCounter - rot + n * 1000) % n) === i);

      // Pulse Bead
      if (isHit) {
        ctx.fillStyle = isCurrentStep ? "#ffffff" : streamColor;
        ctx.beginPath();
        ctx.arc(bx, by, isCurrentStep ? 5.5 : 4, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillStyle = colPanel2;
        ctx.strokeStyle = colLine;
        ctx.beginPath();
        ctx.arc(bx, by, 2.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    }
  }

  // 3. Draw Outer Boolean Master Ring (Ring 0)
  const masterRadius = ringRadii[0];
  const op = state.beuclidOp || "xor";
  for (let i = 0; i < masterSteps; i++) {
    const angle = (i / masterSteps) * Math.PI * 2 - Math.PI / 2;
    const bx = cx + Math.cos(angle) * masterRadius;
    const by = cy + Math.sin(angle) * masterRadius;

    const hitA = evaluateStreamHit(0, i);
    const hitB = evaluateStreamHit(1, i);
    const hitC = evaluateStreamHit(2, i);
    const hitD = evaluateStreamHit(3, i);
    const isMasterHit = evaluateBooleanLogic(op, hitA, hitB, hitC, hitD);
    const isNow = (simStepCounter % masterSteps === i);

    if (isMasterHit) {
      ctx.fillStyle = isNow ? "#ffffff" : colAccent;
      ctx.beginPath();
      ctx.arc(bx, by, isNow ? 6.5 : 5, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.fillStyle = colPanel2;
      ctx.strokeStyle = colLine;
      ctx.beginPath();
      ctx.arc(bx, by, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }

  // 4. Draw Rotating Playhead Line
  ctx.strokeStyle = colFg;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx + Math.cos(playheadAngle) * (masterRadius + 8), cy + Math.sin(playheadAngle) * (masterRadius + 8));
  ctx.stroke();

  // Center Coincidence Readout
  ctx.fillStyle = colFg;
  ctx.font = "bold 13px monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(op.toUpperCase(), cx, cy - 6);

  ctx.fillStyle = (lastCoincidenceCount >= 2) ? colAccent2 : colDim;
  ctx.font = "bold 10px monospace";
  ctx.fillText(`COINC: ${lastCoincidenceCount}`, cx, cy + 9);

  // 5. Update HUD status readout
  if (hudElement) {
    const hitCount = [0, 1, 2, 3].map((s) => evaluateStreamHit(s, simStepCounter)).reduce((a, b) => a + b, 0);
    hudElement.textContent = `OP: ${op.toUpperCase()} · STEP: ${simStepCounter} · ACTIVE HITS: ${hitCount}/4 · COINC: ${lastCoincidenceCount}`;
  }
}

// Controller synchronization references
let ctrlPreset = null;
let ctrlOp = null;
let ctrlVoices = null;
let ctrlBoost = null;
let ctrlOctLeap = null;
let ctrlSpeed = null;
let ctrlGate = null;
let notesSection = null;

function syncControlsFromState() {
  if (ctrlOp?.setValue) ctrlOp.setValue(state.beuclidOp ?? "xor", false);
  if (ctrlVoices?.setValue) ctrlVoices.setValue(state.beuclidVoices ?? 4, false);
  if (ctrlBoost?.setValue) ctrlBoost.setValue(state.beuclidBoost ?? 80, false);
  if (ctrlOctLeap?.setValue) ctrlOctLeap.setValue(state.beuclidOctLeap ?? 50, false);
  if (ctrlSpeed?.setValue) ctrlSpeed.setValue(state.beuclidSpeed ?? 1.0, false);
  if (ctrlGate?.setValue) ctrlGate.setValue(state.beuclidGate ?? 70, false);
}

/**
 * Initializes DOM elements and controls for the Boolean Euclidean model.
 */
export function initBooleanEuclidean() {
  const container = document.getElementById("model-boolean_euclidean");
  if (!container) return;
  containerEl = container;
  container.innerHTML = "";

  // Main layout: Workspace (Canvas) + Controls Sidebar
  const layout = document.createElement("div");
  layout.className = "model-layout";
  layout.style.display = "grid";
  layout.style.gridTemplateColumns = "1fr 340px";
  layout.style.gap = "16px";
  layout.style.alignItems = "start";

  // Visualizer Panel
  const visualizerCard = document.createElement("div");
  visualizerCard.className = "card";
  visualizerCard.style.padding = "12px";
  visualizerCard.style.display = "flex";
  visualizerCard.style.flexDirection = "column";
  visualizerCard.style.gap = "10px";

  // Top header with transport button and HUD readout
  const topBar = document.createElement("div");
  topBar.style.display = "flex";
  topBar.style.justifyContent = "space-between";
  topBar.style.alignItems = "center";

  const btnRun = actionBtn("Run", toggleBooleanEuclidean, "Start/Stop autonomous Boolean Euclidean logic clock");

  hudElement = document.createElement("div");
  hudElement.className = "hud-readout";
  hudElement.style.fontFamily = "monospace";
  hudElement.style.fontSize = "11px";
  hudElement.style.color = "var(--dim)";
  hudElement.textContent = "OP: XOR · STEP: 0 · ACTIVE HITS: 0 · COINC: 0";

  topBar.appendChild(btnRun);
  topBar.appendChild(hudElement);
  visualizerCard.appendChild(topBar);

  // Canvas
  canvasEl = document.createElement("canvas");
  canvasEl.width = 440;
  canvasEl.height = 440;
  canvasEl.style.width = "100%";
  canvasEl.style.maxHeight = "520px";
  canvasEl.style.aspectRatio = "1 / 1";
  canvasEl.style.background = "var(--panel)";
  canvasEl.style.border = "1px solid var(--line)";
  canvasEl.style.cursor = "pointer";
  canvasEl.style.display = "block";

  ctx = canvasEl.getContext("2d");

  // Canvas click listener to rotate stream offsets
  canvasEl.addEventListener("click", () => {
    for (let s = 0; s < MAX_STREAMS; s++) {
      streamRot[s] = (streamRot[s] + 1) % streamN[s];
    }
    doGenerate(true);
  });

  visualizerCard.appendChild(canvasEl);

  // Quick Action Buttons
  const actionRow = document.createElement("div");
  actionRow.style.display = "flex";
  actionRow.style.gap = "6px";
  actionRow.style.flexWrap = "wrap";

  actionRow.appendChild(actionBtn("Rot A +1", () => {
    streamRot[0] = (streamRot[0] + 1) % streamN[0];
    doGenerate(true);
  }, "Rotate Stream A phase offset by +1"));

  actionRow.appendChild(actionBtn("Rot B +1", () => {
    streamRot[1] = (streamRot[1] + 1) % streamN[1];
    doGenerate(true);
  }, "Rotate Stream B phase offset by +1"));

  actionRow.appendChild(actionBtn("Swap A↔B", () => {
    const kTmp = streamK[0]; streamK[0] = streamK[1]; streamK[1] = kTmp;
    const nTmp = streamN[0]; streamN[0] = streamN[1]; streamN[1] = nTmp;
    doGenerate(true);
  }, "Swap parameters of Stream A and Stream B"));

  actionRow.appendChild(actionBtn("Mute C/D", () => {
    streamMute[2] ^= 1;
    streamMute[3] ^= 1;
    doGenerate(true);
  }, "Toggle mute states for auxiliary Streams C & D"));

  visualizerCard.appendChild(actionRow);
  layout.appendChild(visualizerCard);

  // Controls Sidebar
  const controlsCard = document.createElement("div");
  controlsCard.className = "card";
  controlsCard.style.padding = "12px";
  controlsCard.style.display = "flex";
  controlsCard.style.flexDirection = "column";
  controlsCard.style.gap = "12px";

  // Preset Selector
  ctrlPreset = dropdown({
    label: "Preset",
    options: BEUCLID_PRESETS.map((p) => ({ value: p.id, label: p.name })),
    value: "tresillo_coincidence",
    onInput: (val) => applyBooleanEuclideanPreset(val),
    tip: "Curated Boolean Euclidean rhythm regimes"
  });
  controlsCard.appendChild(ctrlPreset);

  // Boolean Operator & Voices
  const opGrid = document.createElement("div");
  opGrid.style.display = "grid";
  opGrid.style.gridTemplateColumns = "1fr 1fr";
  opGrid.style.gap = "8px";

  ctrlOp = dropdown({
    label: "Logic Op",
    options: BOOLEAN_OPERATORS.map((o) => ({ value: o.id, label: o.name })),
    value: state.beuclidOp || "xor",
    onInput: (val) => { state.beuclidOp = val; doGenerate(true); },
    tip: "Boolean logic operator combining Euclidean pulse streams"
  });
  opGrid.appendChild(ctrlOp);

  ctrlVoices = dropdown({
    label: "Voices",
    options: [1, 2, 3, 4, 5, 6, 7, 8].map((v) => ({ value: v, label: `${v} Voice${v > 1 ? "s" : ""}` })),
    value: state.beuclidVoices || 4,
    onInput: (val) => { state.beuclidVoices = Number(val); doGenerate(true); },
    tip: "Number of polyphonic outputs (up to 8 voices)"
  });
  opGrid.appendChild(ctrlVoices);
  controlsCard.appendChild(opGrid);

  // Knobs & Sliders
  const knobRow = document.createElement("div");
  knobRow.style.display = "grid";
  knobRow.style.gridTemplateColumns = "1fr 1fr 1fr 1fr";
  knobRow.style.gap = "8px";

  ctrlBoost = knob({
    label: "BOOST",
    min: 0,
    max: 100,
    step: 1,
    value: state.beuclidBoost || 80,
    def: 80,
    onInput: (val) => { state.beuclidBoost = val; },
    tip: "Coincidence velocity accent boost (%)"
  });
  knobRow.appendChild(ctrlBoost);

  ctrlOctLeap = knob({
    label: "LEAP",
    min: 0,
    max: 100,
    step: 5,
    value: state.beuclidOctLeap || 50,
    def: 50,
    onInput: (val) => { state.beuclidOctLeap = val; },
    tip: "Coincidence harmonic octave leap probability (%)"
  });
  knobRow.appendChild(ctrlOctLeap);

  ctrlSpeed = knob({
    label: "SPD",
    min: 0.25,
    max: 4.0,
    step: 0.05,
    value: state.beuclidSpeed || 1.0,
    def: 1.0,
    onInput: (val) => { state.beuclidSpeed = val; },
    tip: "Clock speed multiplier factor"
  });
  knobRow.appendChild(ctrlSpeed);

  ctrlGate = knob({
    label: "GATE",
    min: 10,
    max: 100,
    step: 5,
    value: state.beuclidGate || 70,
    def: 70,
    onInput: (val) => { state.beuclidGate = val; },
    tip: "Note gate duration (% of step interval)"
  });
  knobRow.appendChild(ctrlGate);
  controlsCard.appendChild(knobRow);

  layout.appendChild(controlsCard);
  container.appendChild(layout);

  syncControlsFromState();
}

/**
 * Activates the model when navigated to.
 */
export function activateBooleanEuclideanModel() {
  setModelGenerator(generateBooleanEuclideanBank);
  setModelRandomizer(randomizeBooleanEuclidean);

  syncControlsFromState();
  if (notesSection && typeof notesSection.sync === "function") {
    notesSection.sync();
  }

  doGenerate(true);

  if (!animFrameId) {
    lastTimestamp = performance.now();
    animFrameId = requestAnimationFrame(animationTick);
  }
}

/**
 * Deactivates the model when navigating away.
 */
export function deactivateBooleanEuclideanModel() {
  stopBooleanEuclidean();
  if (animFrameId) {
    cancelAnimationFrame(animFrameId);
    animFrameId = null;
  }
  setModelGenerator(null);
  setModelRandomizer(null);
}

