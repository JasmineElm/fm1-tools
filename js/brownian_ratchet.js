// brownian_ratchet.js — Brownian Thermal Ratchet / Feynman Thermal Diode Sequencer for FM-1 Pulses.
// Simulates Richard Feynman's microscopic thermal ratchet: a paddle wheel immersed in a fluctuating
// thermal bath (T1) drives a toothed cogwheel restricted to unidirectional forward rotation by an
// asymmetric spring-loaded pawl immersed in a separate heat bath (T2) against counter-torque load.
//
// Generative Architecture:
// 1. Stochastic Overdamped Langevin Thermodynamics:
//    - Solves Langevin equation of motion:
//      I * dω/dt = -γ * ω - dV(θ)/dθ - τ_load + τ_pawl + sqrt(2 * γ * T1) * ξ(t)
//      dθ/dt = ω
//    - Asymmetric sawtooth potential energy barrier V(θ) with tooth asymmetry factor α.
//    - Pawl thermal activation: Thermal noise in bath T2 allows probabilistic pawl lift:
//      P_slip = exp(-E_pawl / (k_B * T2)).
//    - When T1 > T2: Rectified forward ratcheting occurs, extracting mechanical work from heat!
//    - When T1 == T2: Isothermal Carnot equilibrium, net average drift is zero.
//    - When T1 < T2: Thermal inversion releases pawl, allowing counter-torque to drive retrograde rotation.
// 2. Musical Tooth Quantization & 8-Voice Hardware Polyphony:
//    - Each tooth click triggers quantized musical pitches across the active scale.
//    - Up to 8 polyphonic pawl chime voices allocated via js/poly.js respecting FM-1 ceiling.
// 3. Continuous Timbre Modulation (CC #74):
//    - Instantaneous thermal velocity variance and angular speed modulate FM-1 CC #74 Brightness.
// 4. Zero GC Churn: Pre-allocated TypedArrays for thermal gas molecules and simulation buffers.

import {
  state, refs, R, setState, scheduleRegen, doGenerate,
  getBank, setBank, getSelected, setSelected, status, onRegen,
  setModelGenerator, setModelRandomizer, RATE_NAMES
} from "./state.js";
import { knob, dropdown, actionBtn } from "./controls.js";
import { isLive, setModelStepHandler, setModelTransportHandler } from "./player.js?v=1";
import { liveNoteOn, liveNoteOff, panicPreview } from "./player.js";
import {
  SCALE_LABELS, ROOT_NOTE_OPTIONS, ROOT_OCTAVE_OPTIONS,
  mapNormalizedToNote, getRootMidi, getActiveScaleIntervals,
  computeOctaveShift, quantize
} from "./scale.js?v=1";
import { syncRhythmGrid } from "./rhythm.js";
import { getActiveModel } from "./modes.js";
import { midiName, SCALES } from "./generator.js";
import { registerModel } from "./snapshot.js";
import { selectPolyVoices, playVoice, releasePolyVoices, getActiveVoiceCount } from "./poly.js";
import * as audio from "./audio.js";

// ---- Constants & Pre-allocated Buffers (Zero GC Churn) ----
export const MAX_VOICES = 8;          // Strict FM-1 8 hardware voices limit
export const NUM_GAS_MOLECULES = 48;  // Thermal bath T1 animated particles

// Pre-allocated gas particle kinematics (bath T1 paddle chamber)
export const gasX = new Float32Array(NUM_GAS_MOLECULES);
export const gasY = new Float32Array(NUM_GAS_MOLECULES);
export const gasVx = new Float32Array(NUM_GAS_MOLECULES);
export const gasVy = new Float32Array(NUM_GAS_MOLECULES);

// Polyphonic Pawl Chimes
export const pawlChimes = [];
for (let i = 0; i < MAX_VOICES; i++) {
  pawlChimes.push({
    id: i,
    note: 60,
    velocity: 0,
    active: false,
    pulseAnim: 0,
    isReverse: false
  });
}

// Brownian Ratchet Presets
export const RATCHET_PRESETS = [
  {
    id: "thermal_rectifier",
    name: "Thermal Rectifier",
    desc: "High temperature gradient drives steady forward ratcheting work against counter-torque",
    t1: 5.2,
    t2: 0.35,
    load: 0.45,
    asym: 0.80,
    teeth: 12,
    barrier: 3.2,
    damping: 1.5
  },
  {
    id: "reversible_carnot",
    name: "Carnot Equilibrium",
    desc: "Equal bath temperatures at thermal equilibrium; Brownian wandering with zero net work",
    t1: 3.2,
    t2: 3.2,
    load: 0.0,
    asym: 0.75,
    teeth: 16,
    barrier: 2.6,
    damping: 1.5
  },
  {
    id: "stalled_overload",
    name: "Stalled Overload",
    desc: "Heavy counter-torque exceeds stall capacity; tense strained micro-clicks and elastic rebounds",
    t1: 4.8,
    t2: 0.5,
    load: 3.2,
    asym: 0.80,
    teeth: 12,
    barrier: 3.6,
    damping: 2.0
  },
  {
    id: "backward_slippage",
    name: "Thermal Inversion",
    desc: "Heated pawl bath thermally releases spring; counter-torque pulls wheel backwards in retrograde tumble",
    t1: 0.6,
    t2: 5.8,
    load: 1.6,
    asym: 0.75,
    teeth: 12,
    barrier: 2.8,
    damping: 1.3
  },
  {
    id: "stochastic_burst",
    name: "Stochastic Plasma",
    desc: "Superheated thermal bath induces torrential bursts, erratic clusters, and energetic ratcheting",
    t1: 9.2,
    t2: 1.2,
    load: 0.85,
    asym: 0.82,
    teeth: 16,
    barrier: 4.2,
    damping: 1.1
  }
];

// Simulation Physics State
export let theta = 0.0;              // Angular position (radians)
export let omega = 0.0;              // Angular velocity (rad/s)
export let toothIndex = 0;           // Current discrete tooth index k
export let prevToothIndex = 0;       // Previous discrete tooth index
export let pawlElevation = 0.0;      // 0.0 = resting on tooth, >0 = lifted
export let forwardClicksCount = 0;   // Diagnostic telemetry
export let reverseClicksCount = 0;   // Diagnostic telemetry
export let lastStepTime = 0;
export let smoothedCcVal = 64;

// Runtime Flags
let isRatchetPlaying = false;
let animFrameId = null;
let lastFrameTime = 0;
let stepTimerAcc = 0;
let dragMode = null;                 // "wheel", "load", "t1", "t2"
let dragStartY = 0;
let dragStartAngle = 0;
let manualTorqueImpulse = 0.0;

// UI & Canvas References
let container = null;
let canvas = null;
let ctx = null;

/**
 * Standard Box-Muller Gaussian random generator with zero allocation.
 */
let boxMullerSpare = null;
export function boxMullerRandom() {
  if (boxMullerSpare !== null) {
    const val = boxMullerSpare;
    boxMullerSpare = null;
    return val;
  }
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  const mag = Math.sqrt(-2.0 * Math.log(u));
  boxMullerSpare = mag * Math.sin(2.0 * Math.PI * v);
  return mag * Math.cos(2.0 * Math.PI * v);
}

/**
 * Initialize gas particles inside the T1 paddle chamber.
 */
export function initGasParticles(T1) {
  const speed = Math.sqrt(Math.max(0.1, T1)) * 0.08;
  for (let i = 0; i < NUM_GAS_MOLECULES; i++) {
    gasX[i] = (Math.random() - 0.5) * 0.8;
    gasY[i] = (Math.random() - 0.5) * 0.8;
    const angle = Math.random() * Math.PI * 2;
    gasVx[i] = Math.cos(angle) * speed;
    gasVy[i] = Math.sin(angle) * speed;
  }
}

/**
 * Configure ratchet simulation parameters from a preset.
 */
export function initRatchetPreset(presetId) {
  const p = RATCHET_PRESETS.find(item => item.id === presetId) || RATCHET_PRESETS[0];
  state.ratchetPreset = p.id;
  state.ratchetT1 = p.t1;
  state.ratchetT2 = p.t2;
  state.ratchetLoad = p.load;
  state.ratchetAsym = p.asym;
  state.ratchetTeeth = p.teeth;
  state.ratchetBarrier = p.barrier;
  state.ratchetDamping = p.damping;
  state.ratchetOctave = state.ratchetOctave ?? 0;

  theta = 0.0;
  omega = 0.0;
  toothIndex = 0;
  prevToothIndex = 0;
  pawlElevation = 0.0;
  forwardClicksCount = 0;
  reverseClicksCount = 0;
  manualTorqueImpulse = 0.0;

  initGasParticles(p.t1);
  resetChimes();
}

/**
 * Clear polyphonic chime voice states.
 */
function resetChimes() {
  for (let i = 0; i < MAX_VOICES; i++) {
    pawlChimes[i].active = false;
    pawlChimes[i].velocity = 0;
    pawlChimes[i].pulseAnim = 0;
  }
}

/**
 * Calculate the conservative asymmetric ratchet potential force: -dV(θ)/dθ.
 */
export function computeRatchetForce(th, teeth, asym, barrier) {
  const lambda = (Math.PI * 2) / teeth;
  // Normalized tooth phase in [0, 1)
  const normPhase = ((th % lambda) + lambda) % lambda / lambda;
  const alpha = Math.max(0.05, Math.min(0.95, asym));

  // Sawtooth potential:
  // For phi in [0, alpha): rising slope = barrier / (alpha * lambda)
  // For phi in [alpha, 1): falling slope = -barrier / ((1 - alpha) * lambda)
  if (normPhase < alpha) {
    return -barrier / (alpha * lambda);
  } else {
    return barrier / ((1.0 - alpha) * lambda);
  }
}

/**
 * Evaluate thermal pawl constraint.
 * Bath T2 induces stochastic lifting of the pawl. If not lifted, pawl blocks reverse motion.
 */
export function computePawlTorque(th, omegaVal, teeth, asym, T2, barrier) {
  const lambda = (Math.PI * 2) / teeth;
  const normPhase = ((th % lambda) + lambda) % lambda / lambda;
  const alpha = Math.max(0.05, Math.min(0.95, asym));

  // The steep cliff is at normPhase near 0 / 1.
  // When rotating in reverse (omegaVal < 0) near the vertical cliff, the pawl catches.
  const isNearCliff = (normPhase < 0.08 || normPhase > 0.95);

  if (isNearCliff && omegaVal < 0) {
    // Thermal lift activation probability: Kramers-like rate
    const thermalEnergy = Math.max(0.04, T2);
    const liftProb = Math.exp(-barrier / thermalEnergy);

    // Stochastic test for pawl lifting
    if (Math.random() < liftProb) {
      pawlElevation = 1.0; // Pawl hopped over the tooth
      return 0.0;          // Reverse slip allowed
    } else {
      // Elastic restoring force preventing backward penetration
      pawlElevation = 0.0;
      return 45.0 * Math.abs(omegaVal) + 15.0; // Strong counter-torque blocking reverse rotation
    }
  } else {
    // Forward rotation gently rides over the tooth
    pawlElevation = Math.max(0.0, 1.0 - Math.abs(normPhase - alpha) / Math.max(0.01, 1.0 - alpha));
    return 0.0;
  }
}

/**
 * Maps a tooth index to an active scale MIDI pitch.
 */
export function getToothNote(idx, numTeeth, octaveShift = 0) {
  const root = getRootMidi();
  const intervals = getActiveScaleIntervals();
  const octOffset = computeOctaveShift(octaveShift);

  const toothMod = ((idx % numTeeth) + numTeeth) % numTeeth;
  const normalized = toothMod / numTeeth;
  const note = mapNormalizedToNote(normalized, intervals, root, 24);
  return Math.max(12, Math.min(127, note + octOffset));
}

/**
 * Numerically advances the Langevin Brownian ratchet simulation by dt seconds.
 */
export function stepSimulation(dt = 0.016) {
  const T1 = state.ratchetT1 ?? 4.0;
  const T2 = state.ratchetT2 ?? 0.5;
  const load = state.ratchetLoad ?? 0.5;
  const asym = state.ratchetAsym ?? 0.8;
  const teeth = Math.max(8, Math.min(24, Math.round(state.ratchetTeeth ?? 12)));
  const barrier = state.ratchetBarrier ?? 3.0;
  const damping = state.ratchetDamping ?? 1.5;
  const inertia = 0.8;

  // 1. Conservative potential force from asymmetric sawtooth
  const fPot = computeRatchetForce(theta, teeth, asym, barrier);

  // 2. Pawl interaction and thermal slip at temperature T2
  const fPawl = computePawlTorque(theta, omega, teeth, asym, T2, barrier);

  // 3. Thermal Langevin fluctuating torque from bath T1 (paddle wheel)
  // Variance of white noise impulse: sqrt(2 * gamma * k_B * T1 / dt)
  const thermalNoise = Math.sqrt((2.0 * damping * T1) / Math.max(0.001, dt)) * boxMullerRandom();

  // 4. Net torque: F_pot - load + pawl + thermal_fluctuation - damping*omega + manual
  const totalTorque = fPot - load + fPawl + thermalNoise - (damping * omega) + manualTorqueImpulse;
  manualTorqueImpulse *= 0.85; // Rapid decay of direct drag impulses

  // 5. Euler-Maruyama integration
  const dOmega = (totalTorque / inertia) * dt;
  omega = Math.max(-40.0, Math.min(40.0, omega + dOmega));
  if (fPawl > 0 && omega < 0) {
    omega = Math.max(0, omega * 0.1);
  }
  theta += omega * dt;

  // 6. Tooth crossing detection
  const lambda = (Math.PI * 2) / teeth;
  const currentTooth = Math.floor(theta / lambda);

  let clicked = false;
  let isReverse = false;

  if (currentTooth > prevToothIndex) {
    // Forward click
    forwardClicksCount++;
    clicked = true;
    isReverse = false;
  } else if (currentTooth < prevToothIndex) {
    // Reverse slip
    reverseClicksCount++;
    clicked = true;
    isReverse = true;
  }

  prevToothIndex = currentTooth;
  toothIndex = currentTooth;

  // 7. Trigger audio note upon tooth click
  if (clicked) {
    const rawNote = getToothNote(toothIndex, teeth, state.ratchetOctave ?? 0);
    const vel = Math.max(45, Math.min(127, Math.round(50 + Math.abs(omega) * 12)));

    // Allocate voice in polyphonic pawl chime ring
    const voiceSlot = Math.abs(currentTooth) % MAX_VOICES;
    const chime = pawlChimes[voiceSlot];
    chime.note = rawNote;
    chime.velocity = vel;
    chime.active = true;
    chime.pulseAnim = 1.0;
    chime.isReverse = isReverse;

    // Dispatch through shared polyphonic voice manager
    const candidates = [{ id: voiceSlot, note: rawNote, velocity: vel }];
    const chosen = selectPolyVoices(candidates, state.polyphony ?? 8, state.polyStrategy ?? "highest");
    for (const c of chosen) {
      playVoice(c.id, c.note, c.velocity, 120);
    }
  }

  // 8. Update gas particles kinematics in paddle chamber
  const gasSpeed = Math.sqrt(Math.max(0.1, T1)) * 0.06;
  for (let i = 0; i < NUM_GAS_MOLECULES; i++) {
    gasX[i] += gasVx[i];
    gasY[i] += gasVy[i];

    // Bounce off chamber boundaries [-0.4, +0.4]
    if (gasX[i] < -0.4) { gasX[i] = -0.4; gasVx[i] = Math.abs(gasVx[i]); }
    if (gasX[i] > 0.4) { gasX[i] = 0.4; gasVx[i] = -Math.abs(gasVx[i]); }
    if (gasY[i] < -0.4) { gasY[i] = -0.4; gasVy[i] = Math.abs(gasVy[i]); }
    if (gasY[i] > 0.4) { gasY[i] = 0.4; gasVy[i] = -Math.abs(gasVy[i]); }

    // Thermal agitation
    if (Math.random() < 0.05) {
      const ang = Math.random() * Math.PI * 2;
      gasVx[i] = Math.cos(ang) * gasSpeed;
      gasVy[i] = Math.sin(ang) * gasSpeed;
    }
  }

  // 10. Decay visual chime pulses
  for (let i = 0; i < MAX_VOICES; i++) {
    if (pawlChimes[i].pulseAnim > 0) {
      pawlChimes[i].pulseAnim = Math.max(0, pawlChimes[i].pulseAnim - 0.06);
      if (pawlChimes[i].pulseAnim === 0) {
        pawlChimes[i].active = false;
      }
    }
  }

  return { clicked, isReverse, toothIndex, omega, theta };
}

/**
 * Generator Function Contract: generateBrownianRatchetBank(state).
 * Always returns a valid 64-step bank array conforming to the shared engine contract.
 */
export function generateBrownianRatchetBank(s) {
  const seqLen = s?.length || 64;
  const teeth = Math.max(8, Math.min(24, Math.round(s?.ratchetTeeth ?? 12)));
  const octave = s?.ratchetOctave ?? 0;
  const steps = [];

  // Deterministically unroll 64 steps based on the ratchet potential
  let simTh = 0;
  let simTooth = 0;
  const T1 = s?.ratchetT1 ?? 4.0;
  const T2 = s?.ratchetT2 ?? 0.5;
  const asym = s?.ratchetAsym ?? 0.25;

  for (let i = 0; i < seqLen; i++) {
    // Forward ratchet progression probability based on T1 vs T2
    const forwardProb = Math.max(0.2, Math.min(0.95, (T1 / (T1 + T2 + 0.1))));
    const advance = (Math.sin(i * 0.45 + (s?.seed || 1)) + 1) * 0.5 < forwardProb;

    if (advance) {
      simTooth++;
    }

    const note = getToothNote(simTooth, teeth, octave);
    const vel = Math.round(60 + ((i % 4 === 0) ? 35 : 15));
    const isGateOn = advance || (i % 2 === 0);

    steps.push({
      note,
      vel,
      notes: isGateOn ? [{ note, vel }] : [],
      gate: isGateOn ? 0.75 : 0.0,
      skip: false
    });
  }

  return [{
    length: seqLen,
    steps,
    rate: s?.rate || "1/16"
  }];
}

/**
 * Direct Manipulation Canvas Rendering.
 * Strictly adheres to Flat Workbench Aesthetic (Zero CSS/Canvas Gradients).
 */
export function renderCanvas() {
  if (!canvas || !ctx) return;

  const w = canvas.width;
  const h = canvas.height;
  if (!w || !h) return;

  const cs = getComputedStyle(document.documentElement);
  const colorBg = cs.getPropertyValue("--panel").trim() || "#18191f";
  const colorPanel2 = cs.getPropertyValue("--panel2").trim() || "#22252e";
  const colorLine = cs.getPropertyValue("--line").trim() || "#333846";
  const colorLineFocus = cs.getPropertyValue("--line-focus").trim() || "#4b5264";
  const colorFg = cs.getPropertyValue("--fg").trim() || "#f3f4f6";
  const colorDim = cs.getPropertyValue("--dim").trim() || "#9ca3af";
  const colorAccent = cs.getPropertyValue("--accent").trim() || "#3b82f6";
  const colorAccent2 = cs.getPropertyValue("--accent2").trim() || "#60a5fa";
  const colorOk = cs.getPropertyValue("--ok").trim() || "#22c55e";
  const colorErr = cs.getPropertyValue("--err").trim() || "#ef4444";

  // Flat canvas clear
  ctx.fillStyle = colorBg;
  ctx.fillRect(0, 0, w, h);

  const cx = w * 0.52;
  const cy = h * 0.50;
  const wheelRadius = Math.min(w, h) * 0.32;
  const teeth = Math.max(8, Math.min(24, Math.round(state.ratchetTeeth ?? 12)));
  const asym = state.ratchetAsym ?? 0.8;

  // 1. Draw Thermal Bath T1 (Paddle Chamber - Left)
  const chamberW = w * 0.22;
  const chamberH = h * 0.70;
  const chamberX = w * 0.04;
  const chamberY = (h - chamberH) * 0.5;

  ctx.fillStyle = colorPanel2;
  ctx.fillRect(chamberX, chamberY, chamberW, chamberH);
  ctx.strokeStyle = colorLine;
  ctx.lineWidth = 1;
  ctx.strokeRect(chamberX, chamberY, chamberW, chamberH);

  // Chamber Header Label
  ctx.fillStyle = colorDim;
  ctx.font = "9px monospace";
  ctx.textAlign = "center";
  ctx.fillText("BATH T1 (PADDLE)", chamberX + chamberW * 0.5, chamberY + 14);
  ctx.fillStyle = colorAccent2;
  ctx.fillText(`${(state.ratchetT1 ?? 4.0).toFixed(1)}°K`, chamberX + chamberW * 0.5, chamberY + 28);

  // Draw thermal gas molecules inside T1 chamber
  ctx.fillStyle = colorFg;
  for (let i = 0; i < NUM_GAS_MOLECULES; i++) {
    const px = chamberX + chamberW * 0.5 + gasX[i] * chamberW;
    const py = chamberY + chamberH * 0.5 + gasY[i] * chamberH * 0.7;
    ctx.fillRect(px, py, 2, 2);
  }

  // Draw connecting drive axle from chamber to cogwheel
  ctx.strokeStyle = colorLineFocus;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(chamberX + chamberW * 0.7, cy);
  ctx.lineTo(cx, cy);
  ctx.stroke();

  // 2. Draw Toothed Cogwheel
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(theta);

  // Outer rim & teeth profile
  ctx.beginPath();
  const toothAngle = (Math.PI * 2) / teeth;
  const toothDepth = wheelRadius * 0.16;

  for (let i = 0; i < teeth; i++) {
    const a0 = i * toothAngle;
    const aDrop = a0 + toothAngle * asym;
    const aNext = (i + 1) * toothAngle;

    // Gentle upward slope
    const rBase = wheelRadius - toothDepth;
    const rTip = wheelRadius;

    if (i === 0) {
      ctx.moveTo(Math.cos(a0) * rBase, Math.sin(a0) * rBase);
    }
    ctx.lineTo(Math.cos(aDrop) * rTip, Math.sin(aDrop) * rTip);
    // Steep vertical drop
    ctx.lineTo(Math.cos(aDrop) * rBase, Math.sin(aDrop) * rBase);
    ctx.lineTo(Math.cos(aNext) * rBase, Math.sin(aNext) * rBase);
  }
  ctx.closePath();

  ctx.fillStyle = colorPanel2;
  ctx.fill();
  ctx.strokeStyle = colorLineFocus;
  ctx.lineWidth = 2;
  ctx.stroke();

  // Inner hub spokes
  ctx.strokeStyle = colorLine;
  ctx.lineWidth = 1;
  for (let i = 0; i < 4; i++) {
    const spokeAng = (i / 4) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(Math.cos(spokeAng) * (wheelRadius - toothDepth), Math.sin(spokeAng) * (wheelRadius - toothDepth));
    ctx.stroke();
  }

  // Axle center pin
  ctx.fillStyle = colorFg;
  ctx.beginPath();
  ctx.arc(0, 0, 5, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();

  // 3. Draw Spring-Loaded Pawl & Bath T2 (Top Right)
  const pawlPivotX = cx + wheelRadius * 0.55;
  const pawlPivotY = cy - wheelRadius * 1.05;
  const pawlTipX = cx + wheelRadius * 0.15;
  const pawlTipY = cy - wheelRadius + (pawlElevation * 8);

  // Bath T2 Indicator Box
  const t2BoxW = 90;
  const t2BoxH = 34;
  const t2BoxX = pawlPivotX - 20;
  const t2BoxY = pawlPivotY - 44;

  ctx.fillStyle = colorPanel2;
  ctx.fillRect(t2BoxX, t2BoxY, t2BoxW, t2BoxH);
  ctx.strokeStyle = colorLine;
  ctx.lineWidth = 1;
  ctx.strokeRect(t2BoxX, t2BoxY, t2BoxW, t2BoxH);

  ctx.fillStyle = colorDim;
  ctx.font = "9px monospace";
  ctx.textAlign = "center";
  ctx.fillText("BATH T2 (PAWL)", t2BoxX + t2BoxW * 0.5, t2BoxY + 13);
  ctx.fillStyle = colorAccent;
  ctx.fillText(`${(state.ratchetT2 ?? 0.5).toFixed(1)}°K`, t2BoxX + t2BoxW * 0.5, t2BoxY + 27);

  // Spring coil
  ctx.strokeStyle = colorDim;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(pawlPivotX, t2BoxY + t2BoxH);
  ctx.lineTo(pawlPivotX - 3, pawlPivotY - 10);
  ctx.lineTo(pawlPivotX + 3, pawlPivotY - 5);
  ctx.lineTo(pawlPivotX, pawlPivotY);
  ctx.stroke();

  // Pawl Pivot Pin
  ctx.fillStyle = colorFg;
  ctx.beginPath();
  ctx.arc(pawlPivotX, pawlPivotY, 4, 0, Math.PI * 2);
  ctx.fill();

  // Pawl Rigid Arm
  ctx.strokeStyle = (pawlElevation > 0.3) ? colorAccent2 : colorFg;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(pawlPivotX, pawlPivotY);
  ctx.lineTo(pawlTipX, pawlTipY);
  ctx.stroke();

  // Pawl Tooth Notch Tip
  ctx.fillStyle = (pawlElevation > 0.3) ? colorAccent2 : colorAccent;
  ctx.fillRect(pawlTipX - 3, pawlTipY - 3, 6, 6);

  // 4. Draw Counter-Torque Load Pulley & Hanging Weight (Right Side)
  const pulleyX = cx + wheelRadius + 28;
  const pulleyY = cy;
  const weightH = 24;
  const weightW = 20;
  const loadVal = state.ratchetLoad ?? 0.5;
  // Hanging position varies with load and current theta
  const stringLength = 60 + Math.min(60, loadVal * 15) + (Math.sin(theta) * 4);
  const weightY = pulleyY + stringLength;

  // Pulley Cord
  ctx.strokeStyle = colorDim;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(pulleyX, pulleyY);
  ctx.lineTo(pulleyX, weightY);
  ctx.stroke();

  // Pulley Wheel
  ctx.fillStyle = colorPanel2;
  ctx.strokeStyle = colorLineFocus;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(pulleyX, pulleyY, 7, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // Hanging Weight Block
  ctx.fillStyle = colorLineFocus;
  ctx.fillRect(pulleyX - weightW * 0.5, weightY, weightW, weightH);
  ctx.strokeStyle = colorFg;
  ctx.lineWidth = 1;
  ctx.strokeRect(pulleyX - weightW * 0.5, weightY, weightW, weightH);

  // Weight Load Label
  ctx.fillStyle = colorFg;
  ctx.font = "8px monospace";
  ctx.textAlign = "center";
  ctx.fillText(`${loadVal.toFixed(1)}τ`, pulleyX, weightY + 15);

  // 5. Draw 8 Polyphonic Pawl Chimes Telemetry (Bottom Strip)
  const chimeY = h - 22;
  const chimeSlotW = (w - 20) / MAX_VOICES;

  for (let i = 0; i < MAX_VOICES; i++) {
    const ch = pawlChimes[i];
    const bx = 10 + i * chimeSlotW;
    const isLit = ch.pulseAnim > 0.05;

    ctx.fillStyle = isLit ? (ch.isReverse ? colorErr : colorOk) : colorPanel2;
    ctx.fillRect(bx + 2, chimeY, chimeSlotW - 4, 16);

    ctx.strokeStyle = isLit ? colorFg : colorLine;
    ctx.lineWidth = 1;
    ctx.strokeRect(bx + 2, chimeY, chimeSlotW - 4, 16);

    ctx.fillStyle = isLit ? "#ffffff" : colorDim;
    ctx.font = "9px monospace";
    ctx.textAlign = "center";
    const noteTxt = midiName(ch.note);
    ctx.fillText(noteTxt, bx + chimeSlotW * 0.5, chimeY + 11);
  }

  // 6. Draw Direct Manipulation & Thermodynamic Stats Overlays
  ctx.fillStyle = colorDim;
  ctx.font = "9px monospace";
  ctx.textAlign = "left";
  const deltaT = ((state.ratchetT1 ?? 4.0) - (state.ratchetT2 ?? 0.5)).toFixed(2);
  ctx.fillText(`ΔT: ${deltaT}°K | Ω: ${omega.toFixed(1)} rad/s | TOOTH: ${toothIndex}`, 12, h - 30);
  ctx.fillText(`CLICKS: +${forwardClicksCount} / -${reverseClicksCount}`, 12, h - 42);
}

/**
 * Handle direct manipulation pointer dragging across the canvas.
 */
function setupCanvasInteractions() {
  if (!canvas) return;

  const getCanvasCoords = (e) => {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY
    };
  };

  canvas.addEventListener("pointerdown", (e) => {
    const { x, y } = getCanvasCoords(e);
    const w = canvas.width;
    const h = canvas.height;
    const cx = w * 0.52;
    const cy = h * 0.50;
    const distToCenter = Math.hypot(x - cx, y - cy);
    const wheelRadius = Math.min(w, h) * 0.32;

    if (distToCenter < wheelRadius) {
      dragMode = "wheel";
      dragStartAngle = Math.atan2(y - cy, x - cx);
      canvas.setPointerCapture(e.pointerId);
    } else if (x > cx + wheelRadius) {
      dragMode = "load";
      dragStartY = y;
      canvas.setPointerCapture(e.pointerId);
    } else if (x < w * 0.3) {
      dragMode = "t1";
      dragStartY = y;
      canvas.setPointerCapture(e.pointerId);
    }
  });

  canvas.addEventListener("pointermove", (e) => {
    if (!dragMode) return;
    const { x, y } = getCanvasCoords(e);
    const w = canvas.width;
    const h = canvas.height;
    const cx = w * 0.52;
    const cy = h * 0.50;

    if (dragMode === "wheel") {
      const currentAngle = Math.atan2(y - cy, x - cx);
      let deltaAngle = currentAngle - dragStartAngle;
      if (deltaAngle > Math.PI) deltaAngle -= Math.PI * 2;
      if (deltaAngle < -Math.PI) deltaAngle += Math.PI * 2;

      manualTorqueImpulse += deltaAngle * 25.0;
      dragStartAngle = currentAngle;
    } else if (dragMode === "load") {
      const dy = y - dragStartY;
      const newLoad = Math.max(-2.0, Math.min(4.0, (state.ratchetLoad ?? 0.5) + dy * 0.02));
      state.ratchetLoad = Math.round(newLoad * 100) / 100;
      if (refs.ratchetLoad) refs.ratchetLoad.setValue(state.ratchetLoad);
      dragStartY = y;
    } else if (dragMode === "t1") {
      const dy = dragStartY - y;
      const newT1 = Math.max(0.1, Math.min(10.0, (state.ratchetT1 ?? 4.0) + dy * 0.04));
      state.ratchetT1 = Math.round(newT1 * 10) / 10;
      if (refs.ratchetT1) refs.ratchetT1.setValue(state.ratchetT1);
      dragStartY = y;
    }
  });

  const endDrag = (e) => {
    if (dragMode) {
      try { canvas.releasePointerCapture(e.pointerId); } catch (_) {}
      dragMode = null;
    }
  };

  canvas.addEventListener("pointerup", endDrag);
  canvas.addEventListener("pointercancel", endDrag);
}

/**
 * Main animation frame loop.
 */
function animLoop(timestamp) {
  if (!lastFrameTime) lastFrameTime = timestamp;
  const dt = Math.min(0.04, (timestamp - lastFrameTime) / 1000);
  lastFrameTime = timestamp;

  if (isRatchetPlaying) {
    stepSimulation(dt);
  }

  renderCanvas();
  if (typeof requestAnimationFrame === "function") {
    animFrameId = requestAnimationFrame(animLoop);
  }
}

export function startBrownianRatchet() {
  isRatchetPlaying = true;
  lastFrameTime = performance.now();
  if (refs.btnPlayRatchet) {
    refs.btnPlayRatchet.textContent = "Stop";
    refs.btnPlayRatchet.classList.add("btn-active");
  }
}

export function stopBrownianRatchet() {
  isRatchetPlaying = false;
  releasePolyVoices();
  resetChimes();
  if (refs.btnPlayRatchet) {
    refs.btnPlayRatchet.textContent = "Play";
    refs.btnPlayRatchet.classList.remove("btn-active");
  }
}

export function toggleBrownianRatchetRunning() {
  if (isRatchetPlaying) {
    stopBrownianRatchet();
  } else {
    startBrownianRatchet();
  }
}

export function isBrownianRatchetRunning() {
  return isRatchetPlaying;
}

/**
 * Workbench Assembly & DOM Initialization.
 */
export function initBrownianRatchet() {
  container = document.getElementById("model-brownian_ratchet");
  if (!container) return;
  container.innerHTML = "";

  // 1. Module Enclosure & Header
  const moduleWrap = document.createElement("div");
  moduleWrap.className = "chladni-wrap"; // Reusing high-contrast clean flat workbench styling

  const header = document.createElement("div");
  header.className = "chladni-header";
  header.innerHTML = `
    <div style="display:flex; align-items:center; gap:8px;">
      <span class="chladni-title">Brownian Thermal Ratchet</span>
      <span class="chladni-tag">Feynman Thermal Diode</span>
    </div>
  `;

  // 2. Interactive Canvas
  canvas = document.createElement("canvas");
  canvas.className = "chladni-canvas";
  canvas.width = 640;
  canvas.height = 360;
  canvas.style.width = "100%";
  canvas.style.height = "auto";
  canvas.style.touchAction = "none";
  ctx = canvas.getContext("2d");

  setupCanvasInteractions();

  // 3. Control Sections Grid
  const controlsGrid = document.createElement("div");
  controlsGrid.className = "chladni-controls-grid";
  controlsGrid.style.display = "grid";
  controlsGrid.style.gridTemplateColumns = "repeat(auto-fit, minmax(280px, 1fr))";
  controlsGrid.style.gap = "8px";
  controlsGrid.style.marginTop = "8px";

  // Section A: Thermal Heat Baths
  const sectBaths = document.createElement("div");
  sectBaths.className = "chladni-card";
  sectBaths.innerHTML = `<div class="chladni-card-title">Thermal Heat Baths</div>`;

  const rowT1 = R("ratchetT1", knob({
    label: "T1 (Paddle)",
    min: 0.1,
    max: 10.0,
    step: 0.1,
    value: state.ratchetT1 ?? 4.0,
    format: v => `${v.toFixed(1)}°`,
    onInput: v => { state.ratchetT1 = v; initGasParticles(v); },
    tip: "Temperature of paddle wheel gas chamber (stochastic drive energy)"
  }));

  const rowT2 = R("ratchetT2", knob({
    label: "T2 (Pawl)",
    min: 0.1,
    max: 10.0,
    step: 0.1,
    value: state.ratchetT2 ?? 0.5,
    format: v => `${v.toFixed(1)}°`,
    onInput: v => { state.ratchetT2 = v; },
    tip: "Temperature of pawl chamber (thermal reverse slip probability)"
  }));

  const rowDamping = R("ratchetDamping", knob({
    label: "Damping (γ)",
    min: 0.5,
    max: 4.0,
    step: 0.1,
    value: state.ratchetDamping ?? 1.5,
    format: v => `${v.toFixed(1)}`,
    onInput: v => { state.ratchetDamping = v; },
    tip: "Viscous fluid friction damping on axle rotation"
  }));

  sectBaths.appendChild(rowT1);
  sectBaths.appendChild(rowT2);
  sectBaths.appendChild(rowDamping);

  // Section B: Mechanical Ratchet & Load
  const sectMech = document.createElement("div");
  sectMech.className = "chladni-card";
  sectMech.innerHTML = `<div class="chladni-card-title">Mechanical Ratchet & Load</div>`;

  const rowLoad = R("ratchetLoad", knob({
    label: "Load (τ)",
    min: -2.0,
    max: 4.0,
    step: 0.05,
    value: state.ratchetLoad ?? 0.5,
    format: v => `${v.toFixed(2)}`,
    onInput: v => { state.ratchetLoad = v; },
    tip: "Counter-torque load opposing forward rotation"
  }));

  const rowAsym = R("ratchetAsym", knob({
    label: "Asymmetry (α)",
    min: 0.1,
    max: 0.9,
    step: 0.02,
    value: state.ratchetAsym ?? 0.25,
    format: v => `${Math.round(v * 100)}%`,
    onInput: v => { state.ratchetAsym = v; },
    tip: "Ratio of tooth slope steepness (asymmetric potential barrier)"
  }));

  const rowTeeth = R("ratchetTeeth", knob({
    label: "Teeth (N)",
    min: 8,
    max: 24,
    step: 1,
    value: state.ratchetTeeth ?? 12,
    format: v => `${Math.round(v)}`,
    onInput: v => { state.ratchetTeeth = Math.round(v); },
    tip: "Number of teeth around cogwheel (quantized melodic divisions)"
  }));

  const rowBarrier = R("ratchetBarrier", knob({
    label: "Barrier (U0)",
    min: 1.0,
    max: 8.0,
    step: 0.2,
    value: state.ratchetBarrier ?? 3.0,
    format: v => `${v.toFixed(1)}`,
    onInput: v => { state.ratchetBarrier = v; },
    tip: "Height of tooth potential barrier"
  }));

  sectMech.appendChild(rowLoad);
  sectMech.appendChild(rowAsym);
  sectMech.appendChild(rowTeeth);
  sectMech.appendChild(rowBarrier);

  // Section C: Presets & Transport
  const sectPresets = document.createElement("div");
  sectPresets.className = "chladni-card";
  sectPresets.innerHTML = `<div class="chladni-card-title">Thermodynamic Presets & Pitch</div>`;

  const presetOptions = RATCHET_PRESETS.map(p => ({ v: p.id, t: p.name }));
  const rowPreset = R("ratchetPreset", dropdown({
    label: "Preset",
    options: presetOptions,
    value: state.ratchetPreset || "thermal_rectifier",
    onInput: v => {
      initRatchetPreset(v);
      syncControls();
    },
    tip: "Thermodynamic operating regimes for Brownian motor"
  }));

  const rowOctave = R("ratchetOctave", knob({
    label: "Octave",
    min: -2,
    max: 2,
    step: 1,
    value: state.ratchetOctave ?? 0,
    format: v => (v > 0 ? `+${v}` : `${v}`),
    onInput: v => { state.ratchetOctave = Math.round(v); },
    tip: "Octave transposition offset for pawl chime voices"
  }));

  const actionGroup = document.createElement("div");
  actionGroup.style.display = "flex";
  actionGroup.style.gap = "6px";
  actionGroup.style.marginTop = "8px";

  const btnNudge = actionBtn("Nudge Torque", () => {
    manualTorqueImpulse += 30.0;
    status("Manual forward torque pulse injected");
  }, "Inject forward angular momentum");

  const btnReset = actionBtn("Reset Wheel", () => {
    theta = 0;
    omega = 0;
    toothIndex = 0;
    forwardClicksCount = 0;
    reverseClicksCount = 0;
    status("Ratchet angle reset to 0");
  }, "Reset wheel angle and click counters");

  const btnRandomize = actionBtn("Randomize", () => {
    randomizeBrownianRatchet();
  }, "Randomize thermodynamic parameters");

  actionGroup.appendChild(btnNudge);
  actionGroup.appendChild(btnReset);
  actionGroup.appendChild(btnRandomize);

  sectPresets.appendChild(rowPreset);
  sectPresets.appendChild(rowOctave);
  sectPresets.appendChild(actionGroup);

  controlsGrid.appendChild(sectBaths);
  controlsGrid.appendChild(sectMech);
  controlsGrid.appendChild(sectPresets);

  moduleWrap.appendChild(header);
  moduleWrap.appendChild(canvas);
  moduleWrap.appendChild(controlsGrid);
  container.appendChild(moduleWrap);

  // Initialize with active preset
  initRatchetPreset(state.ratchetPreset || "thermal_rectifier");

  // Wire model hooks
  setModelGenerator("brownian_ratchet", generateBrownianRatchetBank);
  setModelStepHandler("brownian_ratchet", () => {
    // In free running continuous mode, steps trigger simulation micro-steps if paused
    if (!isRatchetPlaying) {
      stepSimulation(0.02);
    }
  });

  // Start rendering loop
  if (!animFrameId && typeof requestAnimationFrame === "function") {
    animFrameId = requestAnimationFrame(animLoop);
  }
}

/**
 * Refresh UI control widgets when state values update.
 */
export function syncControls() {
  if (refs.ratchetT1) refs.ratchetT1.setValue(state.ratchetT1);
  if (refs.ratchetT2) refs.ratchetT2.setValue(state.ratchetT2);
  if (refs.ratchetLoad) refs.ratchetLoad.setValue(state.ratchetLoad);
  if (refs.ratchetAsym) refs.ratchetAsym.setValue(state.ratchetAsym);
  if (refs.ratchetTeeth) refs.ratchetTeeth.setValue(state.ratchetTeeth);
  if (refs.ratchetBarrier) refs.ratchetBarrier.setValue(state.ratchetBarrier);
  if (refs.ratchetDamping) refs.ratchetDamping.setValue(state.ratchetDamping);
  if (refs.ratchetOctave) refs.ratchetOctave.setValue(state.ratchetOctave);
  if (refs.ratchetPreset) refs.ratchetPreset.setValue(state.ratchetPreset);
}

export function randomizeBrownianRatchet() {
  const preset = RATCHET_PRESETS[Math.floor(Math.random() * RATCHET_PRESETS.length)];
  state.ratchetPreset = preset.id;
  state.ratchetT1 = Math.round((0.5 + Math.random() * 8.5) * 10) / 10;
  state.ratchetT2 = Math.round((0.1 + Math.random() * 4.0) * 10) / 10;
  state.ratchetLoad = Math.round((-0.5 + Math.random() * 3.0) * 100) / 100;
  state.ratchetAsym = Math.round((0.2 + Math.random() * 0.65) * 100) / 100;
  state.ratchetTeeth = Math.floor(Math.random() * 12) + 8;
  state.ratchetBarrier = Math.round((1.5 + Math.random() * 4.0) * 10) / 10;
  state.ratchetDamping = Math.round((0.8 + Math.random() * 2.0) * 10) / 10;
  state.ratchetOctave = Math.floor(Math.random() * 3) - 1;
  initGasParticles(state.ratchetT1);
  syncControls();
  renderCanvas();
  status(`Brownian Ratchet randomized: T1=${state.ratchetT1}°, T2=${state.ratchetT2}°, Load=${state.ratchetLoad}`);
}

export function activateBrownianRatchetModel() {
  if (container) container.style.display = "block";
  stopBrownianRatchet();
  setModelRandomizer(randomizeBrownianRatchet);
  setModelTransportHandler({
    start: startBrownianRatchet,
    stop: stopBrownianRatchet,
    toggle: toggleBrownianRatchetRunning,
    isRunning: isBrownianRatchetRunning
  });
  renderCanvas();
  if (!animFrameId && typeof requestAnimationFrame === "function") {
    lastFrameTime = performance.now();
    animFrameId = requestAnimationFrame(animLoop);
  }
}

export function deactivateBrownianRatchetModel() {
  stopBrownianRatchet();
  setModelRandomizer(null);
  setModelTransportHandler(null);
  if (container) container.style.display = "none";
  if (animFrameId && typeof cancelAnimationFrame === "function") {
    cancelAnimationFrame(animFrameId);
    animFrameId = null;
  }
}

// Register Snapshot Serialization
registerModel({
  id: "brownian_ratchet",
  version: 1,
  capture: () => ({
    preset: state.ratchetPreset,
    t1: state.ratchetT1,
    t2: state.ratchetT2,
    load: state.ratchetLoad,
    asym: state.ratchetAsym,
    teeth: state.ratchetTeeth,
    barrier: state.ratchetBarrier,
    damping: state.ratchetDamping,
    octave: state.ratchetOctave,
    theta,
    omega,
    toothIndex
  }),
  restore: (data) => {
    if (!data) return;
    if (data.preset) state.ratchetPreset = data.preset;
    if (data.t1 !== undefined) state.ratchetT1 = data.t1;
    if (data.t2 !== undefined) state.ratchetT2 = data.t2;
    if (data.load !== undefined) state.ratchetLoad = data.load;
    if (data.asym !== undefined) state.ratchetAsym = data.asym;
    if (data.teeth !== undefined) state.ratchetTeeth = data.teeth;
    if (data.barrier !== undefined) state.ratchetBarrier = data.barrier;
    if (data.damping !== undefined) state.ratchetDamping = data.damping;
    if (data.octave !== undefined) state.ratchetOctave = data.octave;
    if (data.theta !== undefined) theta = data.theta;
    if (data.omega !== undefined) omega = data.omega;
    if (data.toothIndex !== undefined) {
      toothIndex = data.toothIndex;
      prevToothIndex = data.toothIndex;
    }
    initGasParticles(state.ratchetT1 ?? 4.0);
    syncControls();
  }
});
