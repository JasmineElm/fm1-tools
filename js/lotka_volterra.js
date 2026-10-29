// lotka_volterra.js — Lotka-Volterra Predator-Prey Ecological Phase Space for FM-1 Pulses.
// Based on the 3-species Hastings-Powell food chain model (Prey, Predator, Apex Predator).
//
// Generative Architecture:
// 1. Hastings-Powell 3-species non-linear differential system with Holling Type II functional responses.
// 2. Symplectic 4th-Order Runge-Kutta (RK4) continuous numerical integration with TypedArray buffers (zero GC).
// 3. Poincaré section directional threshold crossings triggering 3-species polyphony.
// 4. Strict 8-voice polyphony ceiling with voice stealing (FM-1 hardware constraint).
// 5. Continuous FM-1 CC #74 Brightness modulation driven by predator-prey density ratio.
// 6. Direct manipulation: draggable phase space canvas, interactive threshold scrubbers, dual Sync/Free modes.

import {
  state, refs, R, setState, scheduleRegen, doGenerate,
  getBank, setBank, getSelected, setSelected, status, onRegen,
  setModelGenerator, setModelRandomizer
} from "./state.js";
import { knob, dropdown, actionBtn } from "./controls.js";
import { isLive, setModelStepHandler, setModelTransportHandler } from "./player.js?v=1";
import { liveNoteOn, liveNoteOff, panicPreview, dispatchTimbreCc } from "./player.js";
import { SCALE_LABELS, ROOT_NOTE_OPTIONS, ROOT_OCTAVE_OPTIONS, mapNormalizedToNote, getRootMidi, getActiveScaleIntervals, computeOctaveShift } from "./scale.js?v=1";
import { syncRhythmGrid, randomizeRhythm } from "./rhythm.js";
import { getActiveModel } from "./modes.js";
import { quantize, midiName, SCALES } from "./generator.js";
import { registerModel } from "./snapshot.js";
import { playVoice, releasePolyVoices } from "./poly.js";
import * as midi from "./midi.js";
import * as audio from "./audio.js";

// ---- Constants & Pre-allocated Buffers (Zero GC Churn) ----
const MAX_VOICES = 8;
const voiceSlots = [null, null, null]; // [prey, predator, apex] active notes

let forceRegenRhythm = false;

// Trail history ring buffer for smooth 2D phase portrait rendering
const TRAIL_LEN = 200;
const trailX = new Float32Array(TRAIL_LEN);
const trailY = new Float32Array(TRAIL_LEN);
const trailZ = new Float32Array(TRAIL_LEN);
let trailHead = 0;
let trailCount = 0;

// Simulation State
let simX = 0.8;
let simY = 0.2;
let simZ = 8.0;
let prevX = simX;
let prevY = simY;
let prevZ = simZ;

let lastLiveStep = -1;
let animFrameId = null;
let lastFrameTime = 0;
let isDraggingCanvas = false;

// UI DOM references
let lvContainer = null;
let phaseCanvas = null;
let meterPrey = null;
let meterPred = null;
let meterApex = null;
let modeToggleBtn = null;
let presetSelect = null;

// Presets for classic ecological regimes
export const LV_PRESETS = [
  {
    id: "limcycle",
    name: "Stable Limit Cycle",
    desc: "Periodic closed orbit: hypnotic 3-way polyrhythm with steady repeating cycles",
    x: 0.75, y: 0.2, z: 8.5,
    a: 5.0, b1: 3.0, b2: 2.0, c: 0.1, d1: 0.4, d2: 0.01,
    thX: 0.54, thY: 0.20, thZ: 8.8,
    speed: 1.0
  },
  {
    id: "teacup",
    name: "Chaotic Tea Cup",
    desc: "Hastings-Powell classic chaotic attractor: folding loops that never repeat",
    x: 0.7, y: 0.22, z: 9.0,
    a: 5.0, b1: 2.8, b2: 2.0, c: 0.1, d1: 0.4, d2: 0.01,
    thX: 0.50, thY: 0.18, thZ: 9.0,
    speed: 1.1
  },
  {
    id: "outbreak",
    name: "Predator Outbreak",
    desc: "Sparse prey grazing building up to explosive predatory chord crescendos",
    x: 0.8, y: 0.15, z: 8.0,
    a: 4.8, b1: 2.6, b2: 2.2, c: 0.12, d1: 0.38, d2: 0.012,
    thX: 0.52, thY: 0.16, thZ: 8.5,
    speed: 1.2
  },
  {
    id: "apex",
    name: "Apex Resonance",
    desc: "Slow grounding sub-bass pulses with rapid shimmering treble prey ostinatos",
    x: 0.75, y: 0.25, z: 9.5,
    a: 5.2, b1: 3.2, b2: 1.8, c: 0.09, d1: 0.42, d2: 0.009,
    thX: 0.58, thY: 0.22, thZ: 9.4,
    speed: 0.9
  },
  {
    id: "phasing",
    name: "Micro-Pulse Phasing",
    desc: "Fast, syncopated three-species polyphonic phasing loops",
    x: 0.65, y: 0.2, z: 8.2,
    a: 4.6, b1: 2.4, b2: 2.4, c: 0.14, d1: 0.36, d2: 0.015,
    thX: 0.48, thY: 0.18, thZ: 8.4,
    speed: 1.4
  }
];

// ---- Differential System Derivatives (Hastings-Powell) ----
function evalDerivatives(x, y, z, a, b1, b2, c, d1, d2) {
  // Holling Type II functional responses
  const f1 = (a * x) / (1 + b1 * x);
  const f2 = (c * y) / (1 + b2 * y);

  const dx = x * (1 - x) - f1 * y;
  const dy = f1 * y - f2 * z - d1 * y;
  const dz = f2 * z - d2 * z;

  return [dx, dy, dz];
}

/**
 * 4th-Order Runge-Kutta Numerical Integrator Step.
 * Evaluates next state vector (X, Y, Z) given step size dt.
 */
function rk4Step(dt) {
  const a = state.lvA ?? 5.0;
  const b1 = state.lvB1 ?? 3.0;
  const b2 = state.lvB2 ?? 2.0;
  const c = state.lvC ?? 0.1;
  const d1 = state.lvD1 ?? 0.4;
  const d2 = state.lvD2 ?? 0.01;
  const speed = state.lvSpeed ?? 1.0;
  const h = Math.min(0.2, Math.max(0.005, dt * speed));

  const [k1x, k1y, k1z] = evalDerivatives(simX, simY, simZ, a, b1, b2, c, d1, d2);
  const [k2x, k2y, k2z] = evalDerivatives(
    simX + 0.5 * h * k1x,
    simY + 0.5 * h * k1y,
    simZ + 0.5 * h * k1z,
    a, b1, b2, c, d1, d2
  );
  const [k3x, k3y, k3z] = evalDerivatives(
    simX + 0.5 * h * k2x,
    simY + 0.5 * h * k2y,
    simZ + 0.5 * h * k2z,
    a, b1, b2, c, d1, d2
  );
  const [k4x, k4y, k4z] = evalDerivatives(
    simX + h * k3x,
    simY + h * k3y,
    simZ + h * k3z,
    a, b1, b2, c, d1, d2
  );

  prevX = simX;
  prevY = simY;
  prevZ = simZ;

  simX += (h / 6) * (k1x + 2 * k2x + 2 * k3x + k4x);
  simY += (h / 6) * (k1y + 2 * k2y + 2 * k3y + k4y);
  simZ += (h / 6) * (k1z + 2 * k2z + 2 * k3z + k4z);

  // Biological bound safeguards (non-negative populations, finite ceiling)
  if (isNaN(simX) || simX < 0.001) simX = 0.05;
  if (isNaN(simY) || simY < 0.001) simY = 0.02;
  if (isNaN(simZ) || simZ < 0.001) simZ = 0.5;

  if (simX > 2.0) simX = 1.8;
  if (simY > 1.5) simY = 1.2;
  if (simZ > 25.0) simZ = 20.0;

  // Record into ring buffer
  trailX[trailHead] = simX;
  trailY[trailHead] = simY;
  trailZ[trailHead] = simZ;
  trailHead = (trailHead + 1) % TRAIL_LEN;
  if (trailCount < TRAIL_LEN) trailCount++;
}

// ---- Audio Dispatch & 8-Voice Polyphony Ceiling (via js/poly.js) ----
function playSpeciesVoice(speciesIdx, note, vel, durMs) {
  playVoice(speciesIdx, note, vel, durMs);
  voiceSlots[speciesIdx] = note;

  // Modulate FM-1 CC #74 Brightness with predator-prey intensity
  const ratio = Math.min(1, Math.max(0, simY / (simX + 0.1)));
  dispatchTimbreCc(ratio, {
    dest: state.lvCcDest ?? 74,
    depth: state.lvCcDepth ?? 85,
    minVal: 15
  });
}

// ---- 2D (X, Y) Phase Space Position to Pitch Mapping ----
/**
 * Maps the 2D (X, Y) phase space trajectory position directly to a scale-quantized MIDI note.
 * Uses a logarithmic scale mapping centered around TH-X (0.54):
 * The closer the X trajectory is to TH-X, the closer together the scale notes are.
 * As X diverges from TH-X, scale notes space further apart across the octave spread.
 */
export function getNoteFromXY(x, y, octaveOffset = 0) {
  const thX = state.lvThresholdX ?? 0.54;
  const xMax = 1.2;
  const dX = (x ?? 0) - thX;
  const maxDX = dX >= 0 ? Math.max(0.001, xMax - thX) : Math.max(0.001, thX);
  const ratioX = Math.min(1, Math.max(0, Math.abs(dX) / maxDX));

  // Logarithmic scale mapping: closer to TH-X = 0.54, scale notes are closer together
  const kX = 3.5;
  const logDistX = Math.log(1 + kX * ratioX) / Math.log(1 + kX);
  const normX = Math.max(0, Math.min(1, 0.5 + 0.5 * Math.sign(dX) * logDistX));

  const normY = Math.max(0, Math.min(1, (y ?? 0) / 0.6));
  const norm = Math.max(0, Math.min(1, 0.65 * normX + 0.35 * normY));

  const root = getRootMidi();
  const intervals = getActiveScaleIntervals();
  const octSpan = Math.min(4, Math.max(1, state.pitchSpan ?? state.lvSpan ?? 3));

  const baseNote = mapNormalizedToNote({
    norm,
    root,
    scale: intervals,
    octaveSpread: octSpan,
    spreadDirection: state.octaveMode || "up",
    octChance: ((state.octave ?? 0) / 100),
    quantStrength: ((state.quantSteps ?? 100) / 100),
    rng: () => 0
  });

  const finalNote = baseNote + octaveOffset * 12;
  return Math.max(12, Math.min(108, Math.round(finalNote)));
}

// ---- Poincaré Section Trigger Check ----
function checkPoincareTriggers(durMs = 180) {
  const thX = state.lvThresholdX ?? 0.54;
  const thY = state.lvThresholdY ?? 0.20;
  const thZ = state.lvThresholdZ ?? 8.8;

  // Species 0: Prey (Treble flutter) — pitch determined by XY trajectory
  if (prevX <= thX && simX > thX) {
    const note = getNoteFromXY(simX, simY);
    const vel = Math.min(127, Math.max(40, Math.round(simX * 100)));
    playSpeciesVoice(0, note, vel, durMs);
    flashMeter(meterPrey);
  }

  // Species 1: Predator (Mid-range ostinato) — pitch determined by XY trajectory
  if (prevY <= thY && simY > thY) {
    const note = getNoteFromXY(simX, simY);
    const vel = Math.min(127, Math.max(45, Math.round(simY * 120)));
    playSpeciesVoice(1, note, vel, durMs + 40);
    flashMeter(meterPred);
  }

  // Species 2: Apex Predator (Sub-bass strike) — pitch determined by XY trajectory
  if (prevZ <= thZ && simZ > thZ) {
    const note = getNoteFromXY(simX, simY);
    const vel = Math.min(127, Math.max(50, Math.round((simZ / 12) * 120)));
    playSpeciesVoice(2, note, vel, durMs + 80);
    flashMeter(meterApex);
  }
}

function flashMeter(el) {
  if (!el) return;
  el.classList.add("is-active");
  setTimeout(() => el.classList.remove("is-active"), 120);
}

// ---- Bank Generator Contract (SYNC Mode Phrase) ----
export function generateLotkaVolterraBank(targetState = state) {
  const rate = targetState.rate !== undefined ? targetState.rate : 6;
  const seqLen = Math.min(64, Math.max(1, targetState.length || 64));

  const intervals = getActiveScaleIntervals();
  const root = getRootMidi();
  const octSpan = Math.min(4, Math.max(1, state.pitchSpan ?? state.lvSpan ?? 3));
  const intLen = intervals.length || 7;

  const currentBank = getBank();
  const existingSteps = currentBank?.[0]?.steps || null;
  const hasExistingRhythm = !forceRegenRhythm && existingSteps && existingSteps.some((st) => (st.notes && st.notes.length > 0) || st._savedNote);

  const phrase = {
    length: seqLen,
    rate,
    steps: []
  };

  // Clone local state to simulate clean reproducible 64-step phrase
  let x = state.lvInitX ?? 0.75;
  let y = state.lvInitY ?? 0.2;
  let z = state.lvInitZ ?? 8.5;
  const a = state.lvA ?? 5.0;
  const b1 = state.lvB1 ?? 3.0;
  const b2 = state.lvB2 ?? 2.0;
  const c = state.lvC ?? 0.1;
  const d1 = state.lvD1 ?? 0.4;
  const d2 = state.lvD2 ?? 0.01;
  const speed = state.lvSpeed ?? 1.0;
  const dt = 0.22 * speed;

  const thX = state.lvThresholdX ?? 0.54;
  const thY = state.lvThresholdY ?? 0.20;
  const thZ = state.lvThresholdZ ?? 8.8;

  let ppx = x, ppy = y, ppz = z;

  for (let s = 0; s < 64; s++) {
    const stepNotes = [];

    // Advance 3 RK4 sub-steps per musical step
    for (let sub = 0; sub < 3; sub++) {
      const px = x, py = y, pz = z;
      const [k1x, k1y, k1z] = evalDerivatives(x, y, z, a, b1, b2, c, d1, d2);
      const [k2x, k2y, k2z] = evalDerivatives(x + 0.5 * dt * k1x, y + 0.5 * dt * k1y, z + 0.5 * dt * k1z, a, b1, b2, c, d1, d2);
      const [k3x, k3y, k3z] = evalDerivatives(x + 0.5 * dt * k2x, y + 0.5 * dt * k2y, z + 0.5 * dt * k2z, a, b1, b2, c, d1, d2);
      const [k4x, k4y, k4z] = evalDerivatives(x + dt * k3x, y + dt * k3y, z + dt * k3z, a, b1, b2, c, d1, d2);

      x += (dt / 6) * (k1x + 2 * k2x + 2 * k3x + k4x);
      y += (dt / 6) * (k1y + 2 * k2y + 2 * k3y + k4y);
      z += (dt / 6) * (k1z + 2 * k2z + 2 * k3z + k4z);

      if (x < 0.01) x = 0.05;
      if (y < 0.01) y = 0.02;
      if (z < 0.1) z = 0.5;

      // Species 0: Prey (Treble flutter) — triggered on threshold upward crossing or population crest
      const preyCross = px <= thX && x > thX;
      const preyCrest = px > ppx && px >= x && px > 0.4;
      if (preyCross || preyCrest) {
        const note = getNoteFromXY(x, y, 0);
        stepNotes.push({ note, vel: Math.min(127, Math.max(45, Math.round(x * 100))), _octOffset: 0 });
      }

      // Species 1: Predator (Mid ostinato) — triggered on threshold upward crossing or population crest
      const predCross = py <= thY && y > thY;
      const predCrest = py > ppy && py >= y && py > 0.15;
      if (predCross || predCrest) {
        const note = getNoteFromXY(x, y, 0);
        stepNotes.push({ note, vel: Math.min(127, Math.max(50, Math.round(y * 120))), _octOffset: 0 });
      }

      // Species 2: Apex (Sub-bass strike) — triggered on threshold upward crossing or population crest
      const apexCross = pz <= thZ && z > thZ;
      const apexCrest = pz > ppz && pz >= z && pz > 7.5;
      if (apexCross || apexCrest) {
        const note = getNoteFromXY(x, y, -1);
        stepNotes.push({ note, vel: Math.min(127, Math.max(55, Math.round((z / 12) * 120))), _octOffset: -1 });
      }

      ppx = px; ppy = py; ppz = pz;
    }

    // Default pitch for resting steps determined by current (X, Y) trajectory
    const defPitch = getNoteFromXY(x, y, 0);
    const finalNotes = stepNotes.slice(0, 2);

    let stepActiveNotes = finalNotes;
    if (hasExistingRhythm && existingSteps[s]) {
      const wasActive = existingSteps[s].notes && existingSteps[s].notes.length > 0;
      if (wasActive) {
        stepActiveNotes = finalNotes.length > 0 ? finalNotes : [{ note: defPitch, vel: 70, _octOffset: 0 }];
      } else {
        stepActiveNotes = [];
      }
    }

    phrase.steps.push({
      notes: stepActiveNotes,
      _savedNote: finalNotes[0] || existingSteps?.[s]?._savedNote || { note: defPitch, vel: 70, _octOffset: 0 },
      _trajX: x,
      _trajY: y,
      _trajZ: z
    });
  }

  return [phrase];
}

/**
 * Re-quantizes pitches for all existing steps in the active bank without altering
 * sequence step gates, polyphony allocation, or rhythm pattern.
 */
export function updateLotkaVolterraScaleAndOctave() {
  const bank = getBank();
  const p = bank?.[0];
  if (!p || !p.steps) return;

  for (let s = 0; s < p.steps.length; s++) {
    const st = p.steps[s];
    const x = st._trajX !== undefined ? st._trajX : (state.lvInitX ?? 0.75);
    const y = st._trajY !== undefined ? st._trajY : (state.lvInitY ?? 0.2);

    if (st.notes && st.notes.length > 0) {
      for (const n of st.notes) {
        n.note = getNoteFromXY(x, y, n._octOffset || 0);
      }
    }
    if (st._savedNote) {
      st._savedNote.note = getNoteFromXY(x, y, st._savedNote._octOffset || 0);
    }
  }

  syncRhythmGrid();
  renderPhaseCanvas();
  updateHud();
}

// ---- Procedural Randomizer (Valid & Finite Dynamical Regimes) ----
export function randomizeLotkaVolterra() {
  const isChaotic = Math.random() < 0.5;

  state.lvInitX = 0.3 + Math.random() * 0.6;
  state.lvInitY = 0.1 + Math.random() * 0.3;
  state.lvInitZ = 7.0 + Math.random() * 3.5;

  if (isChaotic) {
    // Hastings-Powell chaotic regime
    state.lvA = 4.8 + Math.random() * 0.5;
    state.lvB1 = 2.6 + Math.random() * 0.4;
    state.lvB2 = 1.9 + Math.random() * 0.5;
    state.lvC = 0.09 + Math.random() * 0.05;
    state.lvD1 = 0.38 + Math.random() * 0.04;
    state.lvD2 = 0.009 + Math.random() * 0.005;
  } else {
    // Periodic limit cycle
    state.lvA = 4.7 + Math.random() * 0.6;
    state.lvB1 = 2.9 + Math.random() * 0.4;
    state.lvB2 = 1.8 + Math.random() * 0.4;
    state.lvC = 0.1 + Math.random() * 0.06;
    state.lvD1 = 0.39 + Math.random() * 0.04;
    state.lvD2 = 0.01 + Math.random() * 0.004;
  }

  state.lvSpeed = 0.9 + Math.random() * 0.6;
  state.lvThresholdX = 0.48 + Math.random() * 0.14;
  state.lvThresholdY = 0.16 + Math.random() * 0.08;
  state.lvThresholdZ = 8.2 + Math.random() * 1.2;
  state.lvPreset = "custom";

  // Re-seed simulation position
  simX = state.lvInitX;
  simY = state.lvInitY;
  simZ = state.lvInitZ;
  prevX = simX; prevY = simY; prevZ = simZ;
  trailCount = 0;

  // Sync controls
  if (refs.lvA?.setValue) refs.lvA.setValue(state.lvA, false);
  if (refs.lvB1?.setValue) refs.lvB1.setValue(state.lvB1, false);
  if (refs.lvC?.setValue) refs.lvC.setValue(state.lvC, false);
  if (refs.lvD2?.setValue) refs.lvD2.setValue(state.lvD2, false);
  if (refs.lvSpeed?.setValue) refs.lvSpeed.setValue(state.lvSpeed, false);
  if (refs.lvThresholdX?.setValue) refs.lvThresholdX.setValue(state.lvThresholdX, false);
  if (refs.lvThresholdY?.setValue) refs.lvThresholdY.setValue(state.lvThresholdY, false);
  if (refs.lvThresholdZ?.setValue) refs.lvThresholdZ.setValue(state.lvThresholdZ, false);
  if (presetSelect) presetSelect.value = "custom";

  forceRegenRhythm = true;
  doGenerate(true);
  forceRegenRhythm = false;
  renderPhaseCanvas();
  updateHud();
  status(`Lotka-Volterra randomized (${isChaotic ? "Chaotic Attractor" : "Limit Cycle"})`, "ok");
}

export function syncLotkaVolterraFromRegen() {
  renderPhaseCanvas();
  updateHud();
}

// ---- Live Step & Animation Loops ----
export function onLotkaVolterraLiveStep(stepIndex) {
  if (stepIndex === null) {
    lastLiveStep = -1;
    return;
  }
  lastLiveStep = stepIndex;

  if (state.lvMode === "sync") {
    // Advance visual simulation along transport clock
    rk4Step(0.04);
    renderPhaseCanvas();
    updateHud();

    // Modulate FM-1 CC #74 Brightness with predator-prey intensity
    const ratio = Math.min(1, Math.max(0, simY / (simX + 0.1)));
    dispatchTimbreCc(ratio, {
      dest: state.lvCcDest ?? 74,
      depth: state.lvCcDepth ?? 85,
      minVal: 15,
      requireLive: true
    });

    // Dynamically derive triggered note pitch from current (X, Y) phase trajectory
    const curBank = getBank();
    const curP = curBank?.[0];
    const st = curP?.steps?.[stepIndex];
    if (st && st.notes && st.notes.length > 0) {
      const liveNote = getNoteFromXY(simX, simY);
      st.notes[0].note = liveNote;
      if (st.notes[1]) {
        st.notes[1].note = getNoteFromXY(simX, simY, -1);
      }
      if (st._savedNote) {
        st._savedNote.note = liveNote;
      }

      const root = getRootMidi();
      for (const n of st.notes) {
        if (n.note >= root + 12) flashMeter(meterPrey);
        else if (n.note < root) flashMeter(meterApex);
        else flashMeter(meterPred);
      }
    }
  }
}

let isLvFreePlaying = false;
export function startLotkaVolterraFree() {
  isLvFreePlaying = true;
  lastFrameTime = performance.now();
}

export function stopLotkaVolterraFree() {
  isLvFreePlaying = false;
  releasePolyVoices();
  panicPreview();
  try { audio.allOff(); } catch (_) {}
  voiceSlots[0] = null;
  voiceSlots[1] = null;
  voiceSlots[2] = null;
  renderPhaseCanvas();
}

export function toggleLotkaVolterraFree() {
  if (isLvFreePlaying) {
    stopLotkaVolterraFree();
    return false;
  } else {
    startLotkaVolterraFree();
    return true;
  }
}

function freeLoop(now) {
  if (state.lvMode === "free") {
    if (isLive()) {
      const dt = lastFrameTime ? Math.min(0.05, (now - lastFrameTime) / 1000) : 0.016;
      lastFrameTime = now;

      rk4Step(dt * 2.0);
      checkPoincareTriggers(state.lvGateLen ?? 160);
      renderPhaseCanvas();
      updateHud();
    } else {
      lastFrameTime = now;
    }
  }

  animFrameId = requestAnimationFrame(freeLoop);
}

// ---- Flat Workbench Visualizer: 2D Phase Space Canvas ----
export function renderPhaseCanvas() {
  if (!phaseCanvas) return;
  const ctx = phaseCanvas.getContext("2d");
  if (!ctx) return;

  const dpr = window.devicePixelRatio || 1;
  const w = phaseCanvas.clientWidth || 480;
  const h = phaseCanvas.clientHeight || 280;

  if (phaseCanvas.width !== Math.round(w * dpr) || phaseCanvas.height !== Math.round(h * dpr)) {
    phaseCanvas.width = Math.round(w * dpr);
    phaseCanvas.height = Math.round(h * dpr);
  }

  ctx.save();
  ctx.scale(dpr, dpr);

  // Dynamic semantic tokens
  const styles = getComputedStyle(document.documentElement);
  const colBg = styles.getPropertyValue("--panel").trim() || "#18191f";
  const colPanel2 = styles.getPropertyValue("--panel2").trim() || "#22252e";
  const colLine = styles.getPropertyValue("--line").trim() || "#333846";
  const colAccent = styles.getPropertyValue("--accent").trim() || "#3b82f6";
  const colAccent2 = styles.getPropertyValue("--accent2").trim() || "#60a5fa";
  const colFg = styles.getPropertyValue("--fg").trim() || "#f3f4f6";
  const colDim = styles.getPropertyValue("--dim").trim() || "#9ca3af";
  const colOk = styles.getPropertyValue("--ok").trim() || "#22c55e";

  // Flat background (Strictly NO gradients)
  ctx.fillStyle = colBg;
  ctx.fillRect(0, 0, w, h);

  // Coordinate projection mapping:
  // X axis: Prey population x in [0, 1.2]
  // Y axis: Predator population y in [0, 0.6]
  const pad = 30;
  const mapX = (v) => pad + (Math.max(0, Math.min(1.2, v)) / 1.2) * (w - pad * 2);
  const mapY = (v) => (h - pad) - (Math.max(0, Math.min(0.6, v)) / 0.6) * (h - pad * 2);

  // 1. Grid lines and Poincaré section cutting planes
  ctx.strokeStyle = colPanel2;
  ctx.lineWidth = 1;

  ctx.beginPath();
  ctx.moveTo(pad, pad); ctx.lineTo(pad, h - pad);
  ctx.lineTo(w - pad, h - pad);
  ctx.stroke();

  // Poincaré cutting planes (X threshold and Y threshold)
  const thX = state.lvThresholdX ?? 0.54;
  const thY = state.lvThresholdY ?? 0.20;

  ctx.strokeStyle = colLine;
  ctx.setLineDash([3, 3]);
  ctx.beginPath();
  // Vertical line at thX
  ctx.moveTo(mapX(thX), pad);
  ctx.lineTo(mapX(thX), h - pad);
  // Horizontal line at thY
  ctx.moveTo(pad, mapY(thY));
  ctx.lineTo(w - pad, mapY(thY));
  ctx.stroke();
  ctx.setLineDash([]);

  // Labels for thresholds
  ctx.fillStyle = colDim;
  ctx.font = "8.5px monospace";
  ctx.textAlign = "center";
  ctx.fillText(`TH-X: ${thX.toFixed(2)}`, mapX(thX), h - pad + 14);
  ctx.textAlign = "right";
  ctx.fillText(`TH-Y: ${thY.toFixed(2)}`, pad - 4, mapY(thY) + 3);

  // 2. Continuous Trajectory Trail
  if (trailCount > 1) {
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = colAccent2;
    ctx.beginPath();

    const startIdx = (trailHead - trailCount + TRAIL_LEN) % TRAIL_LEN;
    ctx.moveTo(mapX(trailX[startIdx]), mapY(trailY[startIdx]));

    for (let i = 1; i < trailCount; i++) {
      const idx = (startIdx + i) % TRAIL_LEN;
      ctx.lineTo(mapX(trailX[idx]), mapY(trailY[idx]));
    }
    ctx.stroke();
  }

  // 3. Current Live State Bob (x, y) with z-depth sizing
  const curX = mapX(simX);
  const curY = mapY(simY);
  const bobRadius = Math.max(4, Math.min(10, (simZ / 12) * 8 + 3));

  ctx.beginPath();
  ctx.arc(curX, curY, bobRadius, 0, Math.PI * 2);
  ctx.fillStyle = colAccent;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = colFg;
  ctx.stroke();

  // 4. Axis Labels
  ctx.fillStyle = colDim;
  ctx.font = "9px monospace";
  ctx.textAlign = "left";
  ctx.fillText("PREY (X) →", w - pad - 60, h - 8);
  ctx.save();
  ctx.translate(12, pad + 60);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText("PREDATOR (Y) →", 0, 0);
  ctx.restore();

  // 5. Header status HUD
  ctx.fillStyle = colFg;
  ctx.font = "9.5px monospace";
  ctx.textAlign = "left";
  const curNote = getNoteFromXY(simX, simY);
  ctx.fillText(`XY PITCH: ${midiName(curNote)} · PREY: ${simX.toFixed(2)} · PRED: ${simY.toFixed(2)} · APEX: ${simZ.toFixed(2)}`, pad, 18);

  ctx.textAlign = "right";
  ctx.fillStyle = colAccent;
  ctx.fillText(`MODE: ${(state.lvMode || "sync").toUpperCase()} · RK4 SPEED: ${(state.lvSpeed || 1.0).toFixed(1)}x`, w - pad, 18);

  ctx.restore();
}

function updateHud() {
  if (meterPrey) meterPrey.style.width = `${Math.min(100, Math.round((simX / 1.2) * 100))}%`;
  if (meterPred) meterPred.style.width = `${Math.min(100, Math.round((simY / 0.6) * 100))}%`;
  if (meterApex) meterApex.style.width = `${Math.min(100, Math.round((simZ / 12.0) * 100))}%`;
}

// ---- UI Assembly & Model Initialization ----
export function initLotkaVolterra() {
  lvContainer = document.getElementById("model-lotka_volterra");
  if (!lvContainer) return;
  lvContainer.innerHTML = "";

  const layout = document.createElement("div");
  layout.className = "layout lv-layout";

  // --- Left Module: Controls & Presets ---
  const module = document.createElement("div");
  module.className = "module lv-module";

  // Card 1: Header, Presets & Mode Toggle
  const headerCard = document.createElement("div");
  headerCard.className = "card";
  headerCard.style.padding = "8px 12px";

  const topRow = document.createElement("div");
  topRow.style.display = "flex";
  topRow.style.alignItems = "center";
  topRow.style.justifyContent = "space-between";

  const titleGroup = document.createElement("div");
  titleGroup.innerHTML = `<h3 style="margin:0; font-size:11px; font-weight:700; color:var(--accent); letter-spacing:1px; text-transform:uppercase;">Lotka-Volterra Attractor</h3>`;

  const actionsGroup = document.createElement("div");
  actionsGroup.style.display = "flex";
  actionsGroup.style.gap = "4px";

  modeToggleBtn = document.createElement("button");
  modeToggleBtn.className = "btn-action";
  modeToggleBtn.style.fontSize = "10px";
  modeToggleBtn.style.padding = "3px 8px";
  modeToggleBtn.textContent = state.lvMode === "free" ? "Free Loop" : "Sync Step";
  modeToggleBtn.title = "Toggle between transport step sync and free-running continuous differential chaos";
  modeToggleBtn.addEventListener("click", () => {
    state.lvMode = state.lvMode === "free" ? "sync" : "free";
    modeToggleBtn.textContent = state.lvMode === "free" ? "Free Loop" : "Sync Step";
    if (state.lvMode === "free") {
      setModelTransportHandler({
        start: startLotkaVolterraFree,
        stop: stopLotkaVolterraFree,
        toggle: toggleLotkaVolterraFree,
        isRunning: () => isLvFreePlaying
      });
      isLvFreePlaying = false;
    } else {
      stopLotkaVolterraFree();
      setModelTransportHandler(null);
    }
    renderPhaseCanvas();
    status(`Lotka-Volterra mode: ${state.lvMode.toUpperCase()}`, "ok");
  });

  const btnRnd = document.createElement("button");
  btnRnd.className = "btn-action primary";
  btnRnd.style.fontSize = "10px";
  btnRnd.style.padding = "3px 8px";
  btnRnd.textContent = "Randomise";
  btnRnd.title = "Generate a new valid, finite Lotka-Volterra regime (or press R/G)";
  btnRnd.addEventListener("click", () => {
    randomizeLotkaVolterra();
  });

  actionsGroup.append(modeToggleBtn, btnRnd);
  topRow.append(titleGroup, actionsGroup);

  // Preset Selector Dropdown
  const presetRow = document.createElement("div");
  presetRow.style.marginTop = "8px";
  presetRow.style.display = "flex";
  presetRow.style.gap = "6px";
  presetRow.style.alignItems = "center";

  const presetLabel = document.createElement("span");
  presetLabel.style.fontSize = "9px";
  presetLabel.style.color = "var(--dim)";
  presetLabel.style.fontWeight = "700";
  presetLabel.textContent = "REGIME:";

  presetSelect = document.createElement("select");
  presetSelect.className = "lsystem-select";
  presetSelect.style.flex = "1";

  for (const p of LV_PRESETS) {
    const opt = document.createElement("option");
    opt.value = p.id;
    opt.textContent = `${p.name} (${p.desc.split(":")[0]})`;
    presetSelect.appendChild(opt);
  }

  const customOpt = document.createElement("option");
  customOpt.value = "custom";
  customOpt.textContent = "Custom (Procedural)";
  presetSelect.appendChild(customOpt);

  presetSelect.value = state.lvPreset || "limcycle";
  presetSelect.addEventListener("change", (e) => {
    const chosen = LV_PRESETS.find((p) => p.id === e.target.value);
    if (chosen) {
      state.lvPreset = chosen.id;
      state.lvInitX = chosen.x;
      state.lvInitY = chosen.y;
      state.lvInitZ = chosen.z;
      state.lvA = chosen.a;
      state.lvB1 = chosen.b1;
      state.lvB2 = chosen.b2;
      state.lvC = chosen.c;
      state.lvD1 = chosen.d1;
      state.lvD2 = chosen.d2;
      state.lvThresholdX = chosen.thX;
      state.lvThresholdY = chosen.thY;
      state.lvThresholdZ = chosen.thZ;
      state.lvSpeed = chosen.speed;

      simX = chosen.x; simY = chosen.y; simZ = chosen.z;
      prevX = simX; prevY = simY; prevZ = simZ;
      trailCount = 0;

      syncControlsFromState();
      forceRegenRhythm = true;
      doGenerate(true);
      forceRegenRhythm = false;
      renderPhaseCanvas();
      updateHud();
    }
  });

  presetRow.append(presetLabel, presetSelect);
  headerCard.append(topRow, presetRow);

  // Card 2: Species Population Meters
  const meterCard = document.createElement("div");
  meterCard.className = "card";
  meterCard.style.padding = "8px 12px";
  meterCard.style.marginTop = "8px";

  meterCard.innerHTML = `
    <div style="font-size:9.5px; font-weight:700; color:var(--dim); letter-spacing:1px; text-transform:uppercase; margin-bottom:6px;">
      3-Species Biomass Density & Triggers
    </div>
    <div class="lv-meter-grid">
      <div class="lv-meter-row">
        <span class="lv-meter-label" style="color:var(--accent);">Prey (x)</span>
        <div class="lv-meter-track"><div id="lv-meter-prey" class="lv-meter-fill prey"></div></div>
      </div>
      <div class="lv-meter-row">
        <span class="lv-meter-label" style="color:var(--accent2);">Predator (y)</span>
        <div class="lv-meter-track"><div id="lv-meter-pred" class="lv-meter-fill pred"></div></div>
      </div>
      <div class="lv-meter-row">
        <span class="lv-meter-label" style="color:var(--fg);">Apex (z)</span>
        <div class="lv-meter-track"><div id="lv-meter-apex" class="lv-meter-fill apex"></div></div>
      </div>
    </div>
  `;

  meterPrey = meterCard.querySelector("#lv-meter-prey");
  meterPred = meterCard.querySelector("#lv-meter-pred");
  meterApex = meterCard.querySelector("#lv-meter-apex");

  // Card 3: Non-Linear Dynamic Knobs
  const paramCard = document.createElement("div");
  paramCard.className = "card";
  paramCard.style.padding = "8px 12px";
  paramCard.style.marginTop = "8px";

  const paramGrid = document.createElement("div");
  paramGrid.className = "lsystem-param-grid";

  const kSpeed = knob({
    label: "SPEED",
    min: 0.2, max: 3.0, step: 0.1,
    value: state.lvSpeed ?? 1.0,
    unit: "x",
    title: "Simulation numerical integration speed factor",
    onChange: (v) => { state.lvSpeed = v; forceRegenRhythm = true; doGenerate(true); forceRegenRhythm = false; }
  });
  R("lvSpeed", kSpeed);

  const kA = knob({
    label: "PREY ATK",
    min: 2.0, max: 8.0, step: 0.1,
    value: state.lvA ?? 5.0,
    unit: "a",
    title: "Prey search & attack consumption rate (a)",
    onChange: (v) => { state.lvA = v; forceRegenRhythm = true; doGenerate(true); forceRegenRhythm = false; }
  });
  R("lvA", kA);

  const kB1 = knob({
    label: "PREY SAT",
    min: 1.0, max: 5.0, step: 0.1,
    value: state.lvB1 ?? 3.0,
    unit: "b1",
    title: "Prey handling saturation constant (b1)",
    onChange: (v) => { state.lvB1 = v; forceRegenRhythm = true; doGenerate(true); forceRegenRhythm = false; }
  });
  R("lvB1", kB1);

  const kC = knob({
    label: "PRED ATK",
    min: 0.02, max: 0.4, step: 0.01,
    value: state.lvC ?? 0.1,
    unit: "c",
    title: "Apex predator predation rate (c)",
    onChange: (v) => { state.lvC = v; forceRegenRhythm = true; doGenerate(true); forceRegenRhythm = false; }
  });
  R("lvC", kC);

  const kD2 = knob({
    label: "APEX LOSS",
    min: 0.002, max: 0.05, step: 0.002,
    value: state.lvD2 ?? 0.01,
    unit: "d2",
    title: "Apex predator natural mortality rate (d2)",
    onChange: (v) => { state.lvD2 = v; forceRegenRhythm = true; doGenerate(true); forceRegenRhythm = false; }
  });
  R("lvD2", kD2);

  const kThX = knob({
    label: "TH PREY",
    min: 0.1, max: 1.0, step: 0.05,
    value: state.lvThresholdX ?? 0.54,
    unit: "",
    title: "Poincaré section threshold for Prey note trigger",
    onChange: (v) => { state.lvThresholdX = v; renderPhaseCanvas(); forceRegenRhythm = true; doGenerate(true); forceRegenRhythm = false; }
  });
  R("lvThresholdX", kThX);

  const kThY = knob({
    label: "TH PRED",
    min: 0.05, max: 0.6, step: 0.05,
    value: state.lvThresholdY ?? 0.20,
    unit: "",
    title: "Poincaré section threshold for Predator note trigger",
    onChange: (v) => { state.lvThresholdY = v; renderPhaseCanvas(); forceRegenRhythm = true; doGenerate(true); forceRegenRhythm = false; }
  });
  R("lvThresholdY", kThY);

  const kCc = knob({
    label: "FM CC#74",
    min: 0, max: 127, step: 1,
    value: state.lvCcDepth ?? 85,
    unit: "",
    title: "FM-1 CC #74 Brightness modulation depth driven by predator-prey ratio",
    onChange: (v) => { state.lvCcDepth = v; }
  });
  R("lvCcDepth", kCc);

  paramGrid.append(kSpeed, kA, kB1, kC, kD2, kThX, kThY, kCc);
  paramCard.appendChild(paramGrid);

  module.append(headerCard, meterCard, paramCard);

  // --- Right Display: 2D Phase Portrait Canvas ---
  const display = document.createElement("div");
  display.className = "display lv-display";

  const canvasCard = document.createElement("div");
  canvasCard.className = "card lv-canvas-card";
  canvasCard.style.padding = "8px 12px";

  const canvasHeader = document.createElement("div");
  canvasHeader.style.display = "flex";
  canvasHeader.style.justifyContent = "space-between";
  canvasHeader.style.alignItems = "center";
  canvasHeader.style.marginBottom = "6px";
  canvasHeader.innerHTML = `
    <span style="font-size:10px; font-weight:700; color:var(--fg); letter-spacing:1px; text-transform:uppercase;">Phase Portrait (Prey vs Predator Trajectory)</span>
    <span style="font-size:9px; color:var(--dim);">Drag canvas to prime population state (x, y)</span>
  `;

  phaseCanvas = document.createElement("canvas");
  phaseCanvas.className = "lv-canvas";
  phaseCanvas.style.width = "100%";
  phaseCanvas.style.height = "280px";
  phaseCanvas.style.display = "block";
  phaseCanvas.style.borderRadius = "4px";
  phaseCanvas.style.cursor = "crosshair";

  // Direct manipulation: Drag or click to set (x, y) coordinates
  const handleCanvasCoord = (e) => {
    const rect = phaseCanvas.getBoundingClientRect();
    const pad = 30;
    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;

    const normX = Math.max(0, Math.min(1, (clickX - pad) / (rect.width - pad * 2)));
    const normY = Math.max(0, Math.min(1, ((rect.height - pad) - clickY) / (rect.height - pad * 2)));

    simX = normX * 1.2;
    simY = normY * 0.6;
    prevX = simX;
    prevY = simY;

    state.lvInitX = simX;
    state.lvInitY = simY;
    trailCount = 0;

    renderPhaseCanvas();
    updateHud();

    // If live in sync mode, immediately update the current playing step to match the dragged XY position
    if (isLive() && lastLiveStep >= 0) {
      const curBank = getBank();
      const st = curBank?.[0]?.steps?.[lastLiveStep];
      if (st && st.notes && st.notes.length > 0) {
        const liveNote = getNoteFromXY(simX, simY);
        st.notes[0].note = liveNote;
        if (st._savedNote) st._savedNote.note = liveNote;
      }
    }
  };

  phaseCanvas.addEventListener("pointerdown", (e) => {
    isDraggingCanvas = true;
    phaseCanvas.setPointerCapture(e.pointerId);
    handleCanvasCoord(e);
    const note = getNoteFromXY(simX, simY);
    playSpeciesVoice(0, note, 95, 180);
  });

  phaseCanvas.addEventListener("pointermove", (e) => {
    if (isDraggingCanvas) {
      const prevNote = getNoteFromXY(simX, simY);
      handleCanvasCoord(e);
      const newNote = getNoteFromXY(simX, simY);
      if (newNote !== prevNote) {
        playSpeciesVoice(0, newNote, 90, 140);
      }
    }
  });

  phaseCanvas.addEventListener("pointerup", (e) => {
    isDraggingCanvas = false;
    try { phaseCanvas.releasePointerCapture(e.pointerId); } catch (_) {}
    if (!isLive()) {
      // Synchronize offline bank starting position while preserving all step gates and rhythm pattern
      forceRegenRhythm = false;
      doGenerate(false);
      renderPhaseCanvas();
      updateHud();
    }
  });

  canvasCard.append(canvasHeader, phaseCanvas);
  display.appendChild(canvasCard);

  layout.append(module, display);
  lvContainer.appendChild(layout);

  renderPhaseCanvas();
  updateHud();
}

function syncControlsFromState() {
  if (refs.lvSpeed?.setValue) refs.lvSpeed.setValue(state.lvSpeed, false);
  if (refs.lvA?.setValue) refs.lvA.setValue(state.lvA, false);
  if (refs.lvB1?.setValue) refs.lvB1.setValue(state.lvB1, false);
  if (refs.lvC?.setValue) refs.lvC.setValue(state.lvC, false);
  if (refs.lvD2?.setValue) refs.lvD2.setValue(state.lvD2, false);
  if (refs.lvThresholdX?.setValue) refs.lvThresholdX.setValue(state.lvThresholdX, false);
  if (refs.lvThresholdY?.setValue) refs.lvThresholdY.setValue(state.lvThresholdY, false);
  if (presetSelect) presetSelect.value = state.lvPreset || "limcycle";
}

// ---- Model Activation Lifecycle ----
export function activateLotkaVolterraModel() {
  setModelGenerator(generateLotkaVolterraBank);
  setModelRandomizer(randomizeLotkaVolterra);
  setModelStepHandler(onLotkaVolterraLiveStep);

  if (state.lvMode === "free") {
    setModelTransportHandler({
      start: startLotkaVolterraFree,
      stop: stopLotkaVolterraFree,
      toggle: toggleLotkaVolterraFree,
      isRunning: () => isLvFreePlaying
    });
    isLvFreePlaying = false;
  } else {
    setModelTransportHandler(null);
  }

  const curBank = getBank();
  const hasExistingSteps = curBank?.[0]?.steps?.some((st) => (st.notes && st.notes.length > 0) || st._savedNote);
  if (!hasExistingSteps) {
    forceRegenRhythm = true;
  }
  doGenerate(true);
  forceRegenRhythm = false;

  syncRhythmGrid();
  renderPhaseCanvas();
  updateHud();

  if (!animFrameId) {
    lastFrameTime = performance.now();
    animFrameId = requestAnimationFrame(freeLoop);
  }
}

export function deactivateLotkaVolterraModel() {
  stopLotkaVolterraFree();
  setModelTransportHandler(null);
  releasePolyVoices();
  setModelStepHandler(null);
  voiceSlots[0] = null;
  voiceSlots[1] = null;
  voiceSlots[2] = null;
  lastLiveStep = -1;

  if (animFrameId) {
    cancelAnimationFrame(animFrameId);
    animFrameId = null;
  }
}

// ---- Session Snapshot Integration ----
registerModel({
  id: "lotka_volterra",
  version: 1,
  migrations: {},
  capture() {
    return {
      x: state.lvInitX,
      y: state.lvInitY,
      z: state.lvInitZ,
      a: state.lvA,
      b1: state.lvB1,
      b2: state.lvB2,
      c: state.lvC,
      d1: state.lvD1,
      d2: state.lvD2,
      speed: state.lvSpeed,
      thX: state.lvThresholdX,
      thY: state.lvThresholdY,
      thZ: state.lvThresholdZ,
      preset: state.lvPreset,
      mode: state.lvMode
    };
  },
  restore(h) {
    if (h?.x !== undefined) state.lvInitX = h.x;
    if (h?.y !== undefined) state.lvInitY = h.y;
    if (h?.z !== undefined) state.lvInitZ = h.z;
    if (h?.a !== undefined) state.lvA = h.a;
    if (h?.b1 !== undefined) state.lvB1 = h.b1;
    if (h?.b2 !== undefined) state.lvB2 = h.b2;
    if (h?.c !== undefined) state.lvC = h.c;
    if (h?.d1 !== undefined) state.lvD1 = h.d1;
    if (h?.d2 !== undefined) state.lvD2 = h.d2;
    if (h?.speed !== undefined) state.lvSpeed = h.speed;
    if (h?.thX !== undefined) state.lvThresholdX = h.thX;
    if (h?.thY !== undefined) state.lvThresholdY = h.thY;
    if (h?.thZ !== undefined) state.lvThresholdZ = h.thZ;
    if (h?.preset !== undefined) state.lvPreset = h.preset;
    if (h?.mode !== undefined) state.lvMode = h.mode;

    simX = state.lvInitX ?? 0.8;
    simY = state.lvInitY ?? 0.2;
    simZ = state.lvInitZ ?? 8.0;
    prevX = simX; prevY = simY; prevZ = simZ;
    trailCount = 0;

    syncControlsFromState();
    renderPhaseCanvas();
    updateHud();
  }
});
