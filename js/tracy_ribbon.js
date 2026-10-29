// tracy_ribbon.js — Electroplankton "Tracy" Ribbon Path Trajectory Sequencer for FM-1 Pulses.
// Inspired by Toshio Iwai's Tracy plankton creature from Nintendo Electroplankton.
// Continuous organic vector spline trajectory, centripetal kinematics, curvature-modulated
// articulation, trailing polyphonic echo droplets, and FM-1 CC #74 Brightness modulation.
//
// Generative Architecture:
// 1. Closed Catmull-Rom Spline Vector Ribbon:
//    - Seamless looping closed ribbon parameterized by uniform arc length s in [0, 1).
//    - Evaluates tangent T(s) = r'(s) / |r'(s)| and curvature kappa(s) = |x'y'' - y'x''| / (x'^2 + y'^2)^(3/2).
//    - Creature locomotion speed adapts to curvature: slows down through sharp hairpin bends,
//      accelerates through straight gliding sweeps.
// 2. Curvature-Modulated Musical Articulation & 8-Voice Hardware Ceiling:
//    - Normalized spatial coordinates (x, y) map to scale degree and register octaves.
//    - Sharp curves (high kappa) generate punchy, accented staccato notes; smooth arcs yield lyrical legato swells.
//    - Trailing tail nodes spawn polyphonic echo droplets up to the strict FM-1 8-voice hardware limit.
// 3. Continuous Timbre Modulation (CC #74):
//    - Dynamic swim speed and centripetal acceleration continuously modulate FM-1 CC #74 Brightness.
// 4. Zero GC Churn & Flat Workbench Aesthetics:
//    - Pre-allocated Float32Array lookup tables for arc length, curvature, and tail kinematics.
//    - Strict zero-gradient flat workbench UI with direct-manipulation vector path drawing.

import {
  state, refs, R, setState, scheduleRegen, doGenerate,
  getBank, setBank, getSelected, setSelected, status, onRegen,
  setModelGenerator, setModelRandomizer, RATE_NAMES
} from "./state.js";
import { knob, dropdown, actionBtn } from "./controls.js";
import { isLive, setModelStepHandler, setModelTransportHandler } from "./player.js?v=1";
import { liveNoteOn, liveNoteOff, panicPreview, dispatchTimbreCc } from "./player.js";
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
export const MAX_CTRL_POINTS = 64;    // Maximum user/preset control points
export const SPLINE_SAMPLES = 256;    // Arc-length parameterization discretization
export const MAX_TAIL_NODES = 8;      // Maximum trailing tail segments

// Pre-allocated control point buffers
export const ctrlX = new Float32Array(MAX_CTRL_POINTS);
export const ctrlY = new Float32Array(MAX_CTRL_POINTS);
export let numCtrlPoints = 0;

// Pre-allocated spline arc-length & curvature lookup tables
export const lutX = new Float32Array(SPLINE_SAMPLES);
export const lutY = new Float32Array(SPLINE_SAMPLES);
export const lutCurv = new Float32Array(SPLINE_SAMPLES);
export const lutDist = new Float32Array(SPLINE_SAMPLES);
export let totalArcLength = 1.0;

// Creature Kinematics & Tail State
export let creatureS = 0.0;           // Normalized arc length in [0, 1)
export let creatureSpeed = 0.4;       // Normalized traversal speed
export let creatureHeading = 0.0;     // Angle in radians
export const tailX = new Float32Array(MAX_TAIL_NODES);
export const tailY = new Float32Array(MAX_TAIL_NODES);

// Polyphonic Droplet Echo Voices
export const dropletVoices = [];
for (let i = 0; i < MAX_VOICES; i++) {
  dropletVoices.push({
    id: i,
    note: 60,
    velocity: 0,
    active: false,
    pulseAnim: 0,
    x: 0,
    y: 0
  });
}

// Ribbon Presets
export const TRACY_PRESETS = [
  {
    id: "figure_eight",
    name: "Lemniscate Loop",
    desc: "Bernoulli infinity figure-eight with symmetric intersecting melodic tiers",
    points: [
      { x: 0.0, y: 0.0 },
      { x: 0.55, y: 0.45 },
      { x: 0.80, y: 0.0 },
      { x: 0.55, y: -0.45 },
      { x: 0.0, y: 0.0 },
      { x: -0.55, y: 0.45 },
      { x: -0.80, y: 0.0 },
      { x: -0.55, y: -0.45 }
    ]
  },
  {
    id: "clover_rosette",
    name: "Clover Rosette",
    desc: "Four symmetrical sweeping petals with tight hairpin turns and wide outer arcs",
    points: [
      { x: 0.0, y: 0.75 },
      { x: 0.35, y: 0.35 },
      { x: 0.75, y: 0.0 },
      { x: 0.35, y: -0.35 },
      { x: 0.0, y: -0.75 },
      { x: -0.35, y: -0.35 },
      { x: -0.75, y: 0.0 },
      { x: -0.35, y: 0.35 }
    ]
  },
  {
    id: "trefoil_knot",
    name: "Trefoil Knot",
    desc: "Three-fold harmonic knot with interwoven register ascents and cascading glides",
    points: [
      { x: 0.0, y: 0.70 },
      { x: 0.45, y: 0.20 },
      { x: 0.65, y: -0.40 },
      { x: 0.15, y: -0.30 },
      { x: -0.15, y: -0.30 },
      { x: -0.65, y: -0.40 },
      { x: -0.45, y: 0.20 }
    ]
  },
  {
    id: "elliptical_orbit",
    name: "Elliptical Glide",
    desc: "Smoothly circulating meditative oval with steady, sustained melodic cycling",
    points: [
      { x: 0.0, y: 0.60 },
      { x: 0.50, y: 0.42 },
      { x: 0.75, y: 0.0 },
      { x: 0.50, y: -0.42 },
      { x: 0.0, y: -0.60 },
      { x: -0.50, y: -0.42 },
      { x: -0.75, y: 0.0 },
      { x: -0.50, y: 0.42 }
    ]
  },
  {
    id: "meandering_river",
    name: "Serpentine Meander",
    desc: "Organic winding river wave with alternating high-frequency bends and broad straights",
    points: [
      { x: -0.70, y: 0.50 },
      { x: -0.35, y: 0.65 },
      { x: 0.10, y: 0.20 },
      { x: 0.60, y: 0.40 },
      { x: 0.75, y: -0.20 },
      { x: 0.30, y: -0.60 },
      { x: -0.20, y: -0.30 },
      { x: -0.65, y: -0.55 }
    ]
  }
];

// Runtime State
let isTracyPlaying = false;
let animFrameId = null;
let lastFrameTime = 0;
let lastTriggerS = 0;
let lastNoteIndex = -1;
let smoothedCcVal = 64;
let swimPhase = 0.0;

// Interactive Drawing State
let isDrawing = false;
let drawnPoints = [];

// UI & Canvas References
let container = null;
let canvas = null;
let ctx = null;

/**
 * Configure control points from preset.
 */
export function initTracyPreset(presetId) {
  const p = TRACY_PRESETS.find(item => item.id === presetId) || TRACY_PRESETS[0];
  state.tracyPreset = p.id;
  state.tracySpeed = state.tracySpeed ?? 1.0;
  state.tracyDivs = state.tracyDivs ?? 16;
  state.tracyCurvSens = state.tracyCurvSens ?? 0.8;
  state.tracyTailLen = state.tracyTailLen ?? 4;
  state.tracyOctave = state.tracyOctave ?? 0;
  state.tracyWiggle = state.tracyWiggle ?? 0.5;

  setControlPoints(p.points);
}

/**
 * Assign control points and build arc-length spline lookup tables.
 */
export function setControlPoints(pts) {
  numCtrlPoints = Math.min(MAX_CTRL_POINTS, pts.length);
  for (let i = 0; i < numCtrlPoints; i++) {
    ctrlX[i] = pts[i].x;
    ctrlY[i] = pts[i].y;
  }
  buildSplineLut();
  creatureS = 0.0;
  lastTriggerS = 0.0;
  lastNoteIndex = -1;
}

/**
 * Catmull-Rom spline interpolation helper.
 */
function catmullRom(p0, p1, p2, p3, t) {
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * (
    (2 * p1) +
    (-p0 + p2) * t +
    (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
    (-p0 + 3 * p1 - 3 * p2 + p3) * t3
  );
}

/**
 * First derivative of Catmull-Rom spline.
 */
function catmullRomDeriv(p0, p1, p2, p3, t) {
  const t2 = t * t;
  return 0.5 * (
    (-p0 + p2) +
    2 * (2 * p0 - 5 * p1 + 4 * p2 - p3) * t +
    3 * (-p0 + 3 * p1 - 3 * p2 + p3) * t2
  );
}

/**
 * Second derivative of Catmull-Rom spline.
 */
function catmullRomDeriv2(p0, p1, p2, p3, t) {
  return 0.5 * (
    2 * (2 * p0 - 5 * p1 + 4 * p2 - p3) +
    6 * (-p0 + 3 * p1 - 3 * p2 + p3) * t
  );
}

/**
 * Discretize the closed Catmull-Rom spline into uniform arc-length lookup tables.
 */
export function buildSplineLut() {
  if (numCtrlPoints < 3) return;

  let accumDist = 0.0;
  lutDist[0] = 0.0;

  for (let i = 0; i < SPLINE_SAMPLES; i++) {
    const normT = i / SPLINE_SAMPLES;
    const globalT = normT * numCtrlPoints;
    const idx1 = Math.floor(globalT) % numCtrlPoints;
    const idx0 = (idx1 - 1 + numCtrlPoints) % numCtrlPoints;
    const idx2 = (idx1 + 1) % numCtrlPoints;
    const idx3 = (idx1 + 2) % numCtrlPoints;
    const localT = globalT - Math.floor(globalT);

    const x = catmullRom(ctrlX[idx0], ctrlX[idx1], ctrlX[idx2], ctrlX[idx3], localT);
    const y = catmullRom(ctrlY[idx0], ctrlY[idx1], ctrlY[idx2], ctrlY[idx3], localT);
    lutX[i] = x;
    lutY[i] = y;

    // Derivatives for curvature
    const dx = catmullRomDeriv(ctrlX[idx0], ctrlX[idx1], ctrlX[idx2], ctrlX[idx3], localT);
    const dy = catmullRomDeriv(ctrlY[idx0], ctrlY[idx1], ctrlY[idx2], ctrlY[idx3], localT);
    const d2x = catmullRomDeriv2(ctrlX[idx0], ctrlX[idx1], ctrlX[idx2], ctrlX[idx3], localT);
    const d2y = catmullRomDeriv2(ctrlY[idx0], ctrlY[idx1], ctrlY[idx2], ctrlY[idx3], localT);

    const speedSq = dx * dx + dy * dy;
    const speed = Math.sqrt(speedSq);
    const curv = Math.abs(dx * d2y - dy * d2x) / Math.max(0.001, speedSq * speed);
    lutCurv[i] = Math.min(8.0, curv);

    if (i > 0) {
      const prevX = lutX[i - 1];
      const prevY = lutY[i - 1];
      const stepDist = Math.hypot(x - prevX, y - prevY);
      accumDist += stepDist;
      lutDist[i] = accumDist;
    }
  }

  // Include closing loop back to sample 0
  const closeDist = Math.hypot(lutX[0] - lutX[SPLINE_SAMPLES - 1], lutY[0] - lutY[SPLINE_SAMPLES - 1]);
  accumDist += closeDist;
  totalArcLength = Math.max(0.01, accumDist);
}

/**
 * Sample position and curvature at normalized arc length s in [0, 1).
 */
export function sampleSplineAtS(s) {
  const normS = ((s % 1.0) + 1.0) % 1.0;
  const targetDist = normS * totalArcLength;

  // Binary search in monotonic lutDist
  let low = 0;
  let high = SPLINE_SAMPLES - 1;
  while (low < high - 1) {
    const mid = (low + high) >> 1;
    if (lutDist[mid] <= targetDist) {
      low = mid;
    } else {
      high = mid;
    }
  }

  const d0 = lutDist[low];
  const d1 = (high === SPLINE_SAMPLES - 1) ? totalArcLength : lutDist[high];
  const span = Math.max(0.0001, d1 - d0);
  const frac = Math.max(0.0, Math.min(1.0, (targetDist - d0) / span));

  const x0 = lutX[low];
  const y0 = lutY[low];
  const x1 = lutX[high];
  const y1 = lutY[high];

  const x = x0 + (x1 - x0) * frac;
  const y = y0 + (y1 - y0) * frac;
  const curv = lutCurv[low] + (lutCurv[high] - lutCurv[low]) * frac;

  // Tangent angle
  const dx = x1 - x0;
  const dy = y1 - y0;
  const heading = Math.atan2(dy, dx);

  return { x, y, curv, heading };
}

/**
 * Maps spatial position (x, y) to scale-quantized MIDI note.
 */
export function getTracyNote(x, y, octaveShift = 0) {
  const root = getRootMidi();
  const intervals = getActiveScaleIntervals();
  const octOffset = computeOctaveShift(octaveShift);

  // X coordinate in [-0.9, 0.9] maps to scale pitch index
  const normX = Math.max(0.0, Math.min(1.0, (x + 0.9) / 1.8));
  // Y coordinate in [-0.9, 0.9] maps to octave / register
  const normY = Math.max(0.0, Math.min(1.0, (y + 0.9) / 1.8));
  const registerOctave = Math.floor(normY * 3) - 1; // -1, 0, +1 octaves

  const note = mapNormalizedToNote(normX, intervals, root, 18);
  return Math.max(12, Math.min(127, note + (registerOctave * 12) + octOffset));
}

/**
 * Numerically advance creature position along ribbon and trigger notes.
 */
export function stepSimulation(dt = 0.016) {
  if (numCtrlPoints < 3) return { triggered: false };

  const baseSpeed = state.tracySpeed ?? 1.0;
  const curvSens = state.tracyCurvSens ?? 0.8;
  const divs = Math.max(4, Math.min(32, Math.round(state.tracyDivs ?? 16)));
  const tailLen = Math.max(1, Math.min(MAX_TAIL_NODES, Math.round(state.tracyTailLen ?? 4)));
  const wiggle = state.tracyWiggle ?? 0.5;

  // Current curvature & kinematics
  const sample = sampleSplineAtS(creatureS);
  creatureHeading = sample.heading;

  // Speed slows down through high-curvature hairpin bends
  const speedScale = 1.0 / (1.0 + curvSens * sample.curv);
  creatureSpeed = baseSpeed * speedScale;

  // Advance creature arc length
  const ds = (creatureSpeed * dt * 0.3) / totalArcLength;
  creatureS = (creatureS + ds) % 1.0;

  // Update creature tail nodes with sinusoidal lateral swimming wiggle
  swimPhase += dt * baseSpeed * 10.0;
  for (let i = 0; i < tailLen; i++) {
    const tailLagS = (creatureS - (i + 1) * 0.015 + 1.0) % 1.0;
    const tailSample = sampleSplineAtS(tailLagS);
    const lateralWiggle = Math.sin(swimPhase - i * 0.8) * (wiggle * 0.04 * (i + 1));
    const normalAng = tailSample.heading + Math.PI * 0.5;

    tailX[i] = tailSample.x + Math.cos(normalAng) * lateralWiggle;
    tailY[i] = tailSample.y + Math.sin(normalAng) * lateralWiggle;
  }

  // Check division milestones along ribbon
  const currentDivIndex = Math.floor(creatureS * divs);
  let triggered = false;

  if (currentDivIndex !== lastNoteIndex) {
    lastNoteIndex = currentDivIndex;
    triggered = true;

    const rawNote = getTracyNote(sample.x, sample.y, state.tracyOctave ?? 0);
    // Curvature determines dynamics: sharp hairpin bends = punchy accented staccato; straight = soft legato
    const curvFactor = Math.min(1.0, sample.curv / 4.0);
    const vel = Math.max(50, Math.min(127, Math.round(65 + curvFactor * 55)));
    const durMs = Math.round(80 + (1.0 - curvFactor) * 220);

    // Allocate in polyphonic droplet ring
    const voiceSlot = currentDivIndex % MAX_VOICES;
    const v = dropletVoices[voiceSlot];
    v.note = rawNote;
    v.velocity = vel;
    v.active = true;
    v.pulseAnim = 1.0;
    v.x = sample.x;
    v.y = sample.y;

    // Dispatch through shared polyphonic voice manager
    const candidates = [{ id: voiceSlot, note: rawNote, velocity: vel }];
    const chosen = selectPolyVoices(candidates, state.polyphony ?? 8, state.polyStrategy ?? "highest");
    for (const c of chosen) {
      playVoice(c.id, c.note, c.velocity, durMs);
    }
  }

  // Modulate FM-1 CC #74 Brightness based on speed and curvature
  const ccNorm = Math.min(1.0, (creatureSpeed * 0.5) + (sample.curv * 0.1));
  const targetCc = Math.round(40 + ccNorm * 80);
  smoothedCcVal = Math.round(smoothedCcVal * 0.9 + targetCc * 0.1);
  dispatchTimbreCc(smoothedCcVal);

  // Decay visual droplet pulses
  for (let i = 0; i < MAX_VOICES; i++) {
    if (dropletVoices[i].pulseAnim > 0) {
      dropletVoices[i].pulseAnim = Math.max(0, dropletVoices[i].pulseAnim - 0.05);
      if (dropletVoices[i].pulseAnim === 0) {
        dropletVoices[i].active = false;
      }
    }
  }

  return { triggered, s: creatureS, noteIndex: currentDivIndex };
}

/**
 * Generator Function Contract: generateTracyRibbonBank(state).
 * Returns a valid 64-step bank array conforming to the engine contract.
 */
export function generateTracyRibbonBank(s) {
  const seqLen = s?.length || 64;
  const divs = Math.max(4, Math.min(32, Math.round(s?.tracyDivs ?? 16)));
  const octave = s?.tracyOctave ?? 0;
  const steps = [];

  for (let i = 0; i < seqLen; i++) {
    const normS = (i / seqLen);
    const sample = sampleSplineAtS(normS);
    const note = getTracyNote(sample.x, sample.y, octave);
    const curvFactor = Math.min(1.0, sample.curv / 4.0);
    const vel = Math.round(65 + curvFactor * 50);

    const isStepTrigger = (i % Math.max(1, Math.floor(seqLen / divs)) === 0);

    steps.push({
      note,
      vel,
      notes: isStepTrigger ? [{ note, vel }] : [],
      gate: isStepTrigger ? 0.75 : 0.0,
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

  // Flat canvas clear
  ctx.fillStyle = colorBg;
  ctx.fillRect(0, 0, w, h);

  const cx = w * 0.5;
  const cy = h * 0.46;
  const scaleX = w * 0.44;
  const scaleY = h * 0.38;

  const toScreenX = (normX) => cx + normX * scaleX;
  const toScreenY = (normY) => cy + normY * scaleY;

  // 1. Draw Subtle Scale Pitch Field Grid
  ctx.strokeStyle = colorLine;
  ctx.lineWidth = 1;
  ctx.strokeRect(cx - scaleX, cy - scaleY, scaleX * 2, scaleY * 2);

  // Pitch division guidelines
  ctx.strokeStyle = colorPanel2;
  for (let g = -0.5; g <= 0.5; g += 0.25) {
    ctx.beginPath();
    ctx.moveTo(cx + g * scaleX * 2, cy - scaleY);
    ctx.lineTo(cx + g * scaleX * 2, cy + scaleY);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(cx - scaleX, cy + g * scaleY * 2);
    ctx.lineTo(cx + scaleX, cy + g * scaleY * 2);
    ctx.stroke();
  }

  // 2. Draw Vector Ribbon Path
  if (numCtrlPoints >= 3) {
    ctx.beginPath();
    for (let i = 0; i < SPLINE_SAMPLES; i++) {
      const sx = toScreenX(lutX[i]);
      const sy = toScreenY(lutY[i]);
      if (i === 0) ctx.moveTo(sx, sy);
      else ctx.lineTo(sx, sy);
    }
    ctx.closePath();

    // Solid flat stroke & fill
    ctx.fillStyle = colorPanel2;
    ctx.fill();
    ctx.strokeStyle = colorLineFocus;
    ctx.lineWidth = 3;
    ctx.stroke();

    // 3. Draw Rhythm Milestone Division Nodes along the Ribbon
    const divs = Math.max(4, Math.min(32, Math.round(state.tracyDivs ?? 16)));
    for (let d = 0; d < divs; d++) {
      const nodeSample = sampleSplineAtS(d / divs);
      const nx = toScreenX(nodeSample.x);
      const ny = toScreenY(nodeSample.y);

      const isCurrent = (d === lastNoteIndex);
      ctx.fillStyle = isCurrent ? colorAccent2 : colorDim;
      ctx.fillRect(nx - 3, ny - 3, 6, 6);
    }

    // 4. Draw Trailing Polyphonic Ripple Droplets
    for (let i = 0; i < MAX_VOICES; i++) {
      const dv = dropletVoices[i];
      if (dv.pulseAnim > 0.05) {
        const dx = toScreenX(dv.x);
        const dy = toScreenY(dv.y);
        const pulseR = 6 + (1.0 - dv.pulseAnim) * 22;

        ctx.strokeStyle = colorAccent;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(dx, dy, pulseR, 0, Math.PI * 2);
        ctx.stroke();

        ctx.fillStyle = colorFg;
        ctx.font = "8px monospace";
        ctx.textAlign = "center";
        ctx.fillText(midiName(dv.note), dx, dy - pulseR - 2);
      }
    }

    // 5. Draw Tracy Plankton Creature
    const creature = sampleSplineAtS(creatureS);
    const headX = toScreenX(creature.x);
    const headY = toScreenY(creature.y);
    const tailLen = Math.max(1, Math.min(MAX_TAIL_NODES, Math.round(state.tracyTailLen ?? 4)));

    // Draw Tail Segments
    ctx.strokeStyle = colorAccent;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(headX, headY);
    for (let i = 0; i < tailLen; i++) {
      const tx = toScreenX(tailX[i]);
      const ty = toScreenY(tailY[i]);
      ctx.lineTo(tx, ty);
    }
    ctx.stroke();

    for (let i = 0; i < tailLen; i++) {
      const tx = toScreenX(tailX[i]);
      const ty = toScreenY(tailY[i]);
      const r = Math.max(2, 6 - i);
      ctx.fillStyle = colorAccent2;
      ctx.beginPath();
      ctx.arc(tx, ty, r, 0, Math.PI * 2);
      ctx.fill();
    }

    // Draw Head & Expressive Eyes
    ctx.save();
    ctx.translate(headX, headY);
    ctx.rotate(creature.heading);

    // Oval Head Body
    ctx.fillStyle = colorFg;
    ctx.beginPath();
    ctx.ellipse(0, 0, 10, 7, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = colorAccent;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Eyes
    ctx.fillStyle = colorBg;
    ctx.beginPath();
    ctx.arc(4, -3, 2, 0, Math.PI * 2);
    ctx.arc(4, 3, 2, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  // 6. Draw User Drawing Line (if actively drawing gesture)
  if (isDrawing && drawnPoints.length > 1) {
    ctx.strokeStyle = colorOk;
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i < drawnPoints.length; i++) {
      const px = toScreenX(drawnPoints[i].x);
      const py = toScreenY(drawnPoints[i].y);
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();
  }

  // 7. Draw 8 Polyphonic Voice Status Cells (Bottom Bar)
  const voiceBarY = h - 22;
  const voiceSlotW = (w - 20) / MAX_VOICES;

  for (let i = 0; i < MAX_VOICES; i++) {
    const v = dropletVoices[i];
    const bx = 10 + i * voiceSlotW;
    const isLit = v.pulseAnim > 0.05;

    ctx.fillStyle = isLit ? colorAccent : colorPanel2;
    ctx.fillRect(bx + 2, voiceBarY, voiceSlotW - 4, 16);

    ctx.strokeStyle = isLit ? colorFg : colorLine;
    ctx.lineWidth = 1;
    ctx.strokeRect(bx + 2, voiceBarY, voiceSlotW - 4, 16);

    ctx.fillStyle = isLit ? "#ffffff" : colorDim;
    ctx.font = "9px monospace";
    ctx.textAlign = "center";
    ctx.fillText(midiName(v.note), bx + voiceSlotW * 0.5, voiceBarY + 11);
  }

  // 8. Status & Curvature Telemetry
  ctx.fillStyle = colorDim;
  ctx.font = "9px monospace";
  ctx.textAlign = "left";
  const curCurv = numCtrlPoints >= 3 ? sampleSplineAtS(creatureS).curv.toFixed(2) : "0.00";
  ctx.fillText(`CURVATURE: ${curCurv} | SPEED: ${creatureSpeed.toFixed(2)} | ARC: ${Math.round(creatureS * 100)}%`, 12, h - 30);
}

/**
 * Setup Pointer Drawing and Canvas Interaction.
 */
function setupCanvasInteractions() {
  if (!canvas) return;

  const getNormCoords = (e) => {
    const rect = canvas.getBoundingClientRect();
    const px = (e.clientX - rect.left) * (canvas.width / rect.width);
    const py = (e.clientY - rect.top) * (canvas.height / rect.height);
    const cx = canvas.width * 0.5;
    const cy = canvas.height * 0.46;
    const scaleX = canvas.width * 0.44;
    const scaleY = canvas.height * 0.38;
    return {
      x: Math.max(-0.9, Math.min(0.9, (px - cx) / scaleX)),
      y: Math.max(-0.9, Math.min(0.9, (py - cy) / scaleY))
    };
  };

  canvas.addEventListener("pointerdown", (e) => {
    isDrawing = true;
    drawnPoints = [getNormCoords(e)];
    canvas.setPointerCapture(e.pointerId);
  });

  canvas.addEventListener("pointermove", (e) => {
    if (!isDrawing) return;
    const pt = getNormCoords(e);
    const last = drawnPoints[drawnPoints.length - 1];
    // Threshold to prevent point overcrowding
    if (Math.hypot(pt.x - last.x, pt.y - last.y) > 0.05) {
      drawnPoints.push(pt);
    }
  });

  const finishDrawing = (e) => {
    if (!isDrawing) return;
    isDrawing = false;
    try { canvas.releasePointerCapture(e.pointerId); } catch (_) {}

    if (drawnPoints.length >= 4) {
      setControlPoints(drawnPoints);
      state.tracyPreset = "custom";
      if (refs.tracyPreset) refs.tracyPreset.setValue("custom");
      status("Custom Tracy ribbon gesture recorded");
    }
  };

  canvas.addEventListener("pointerup", finishDrawing);
  canvas.addEventListener("pointercancel", finishDrawing);
}

/**
 * Main animation loop.
 */
function animLoop(timestamp) {
  if (!lastFrameTime) lastFrameTime = timestamp;
  const dt = Math.min(0.04, (timestamp - lastFrameTime) / 1000);
  lastFrameTime = timestamp;

  if (isTracyPlaying) {
    stepSimulation(dt);
  }

  renderCanvas();
  animFrameId = requestAnimationFrame(animLoop);
}

export function startTracyRibbon() {
  isTracyPlaying = true;
  lastFrameTime = performance.now();
  if (refs.btnPlayTracy) {
    refs.btnPlayTracy.textContent = "Stop";
    refs.btnPlayTracy.classList.add("btn-active");
  }
}

export function stopTracyRibbon() {
  isTracyPlaying = false;
  releasePolyVoices();
  for (let i = 0; i < MAX_VOICES; i++) {
    dropletVoices[i].active = false;
    dropletVoices[i].pulseAnim = 0;
  }
  if (refs.btnPlayTracy) {
    refs.btnPlayTracy.textContent = "Play";
    refs.btnPlayTracy.classList.remove("btn-active");
  }
}

export function toggleTracyRibbonRunning() {
  if (isTracyPlaying) {
    stopTracyRibbon();
  } else {
    startTracyRibbon();
  }
}

export function isTracyRibbonRunning() {
  return isTracyPlaying;
}

/**
 * Workbench Assembly & DOM Initialization.
 */
export function initTracyRibbon() {
  container = document.getElementById("model-tracy_ribbon");
  if (!container) return;
  container.innerHTML = "";

  // 1. Module Enclosure & Header
  const moduleWrap = document.createElement("div");
  moduleWrap.className = "chladni-wrap";

  const header = document.createElement("div");
  header.className = "chladni-header";
  header.innerHTML = `
    <div style="display:flex; align-items:center; gap:8px;">
      <span class="chladni-title">Electroplankton Tracy Ribbon</span>
      <span class="chladni-tag">Spline Vector Trajectory</span>
    </div>
  `;

  // 2. Interactive Drawing Canvas
  canvas = document.createElement("canvas");
  canvas.className = "chladni-canvas";
  canvas.width = 640;
  canvas.height = 360;
  canvas.style.width = "100%";
  canvas.style.height = "auto";
  canvas.style.touchAction = "none";
  ctx = canvas.getContext("2d");

  setupCanvasInteractions();

  // 3. Controls Sections Grid
  const controlsGrid = document.createElement("div");
  controlsGrid.className = "chladni-controls-grid";
  controlsGrid.style.display = "grid";
  controlsGrid.style.gridTemplateColumns = "repeat(auto-fit, minmax(280px, 1fr))";
  controlsGrid.style.gap = "8px";
  controlsGrid.style.marginTop = "8px";

  // Section A: Locomotion & Path Presets
  const sectPath = document.createElement("div");
  sectPath.className = "chladni-card";
  sectPath.innerHTML = `<div class="chladni-card-title">Ribbon Path & Presets</div>`;

  const presetOptions = [
    ...TRACY_PRESETS.map(p => ({ v: p.id, t: p.name })),
    { v: "custom", t: "Custom Drawn Gesture" }
  ];
  const rowPreset = R("tracyPreset", dropdown({
    label: "Ribbon",
    options: presetOptions,
    value: state.tracyPreset || "figure_eight",
    onInput: v => {
      if (v !== "custom") {
        initTracyPreset(v);
      }
    },
    tip: "Select ribbon path geometry, or draw your own directly on the canvas"
  }));

  const rowSpeed = R("tracySpeed", knob({
    label: "Speed",
    min: 0.2,
    max: 3.0,
    step: 0.05,
    value: state.tracySpeed ?? 1.0,
    format: v => `${v.toFixed(2)}x`,
    onInput: v => { state.tracySpeed = v; },
    tip: "Base locomotion travel speed along the ribbon"
  }));

  const rowDivs = R("tracyDivs", knob({
    label: "Divisions",
    min: 4,
    max: 32,
    step: 1,
    value: state.tracyDivs ?? 16,
    format: v => `${Math.round(v)}`,
    onInput: v => { state.tracyDivs = Math.round(v); },
    tip: "Number of quantized rhythmic trigger points positioned along the ribbon"
  }));

  sectPath.appendChild(rowPreset);
  sectPath.appendChild(rowSpeed);
  sectPath.appendChild(rowDivs);

  // Section B: Kinematics & Articulation
  const sectKinematics = document.createElement("div");
  sectKinematics.className = "chladni-card";
  sectKinematics.innerHTML = `<div class="chladni-card-title">Kinematics & Articulation</div>`;

  const rowCurvSens = R("tracyCurvSens", knob({
    label: "Curv Sens",
    min: 0.0,
    max: 2.0,
    step: 0.05,
    value: state.tracyCurvSens ?? 0.8,
    format: v => `${Math.round(v * 100)}%`,
    onInput: v => { state.tracyCurvSens = v; },
    tip: "Sensitivity of speed and velocity articulation to hairpin curve bends"
  }));

  const rowTailLen = R("tracyTailLen", knob({
    label: "Tail Droplets",
    min: 1,
    max: 8,
    step: 1,
    value: state.tracyTailLen ?? 4,
    format: v => `${Math.round(v)}`,
    onInput: v => { state.tracyTailLen = Math.round(v); },
    tip: "Length of undulating swimming tail and trailing polyphonic echo droplets"
  }));

  const rowWiggle = R("tracyWiggle", knob({
    label: "Swim Wiggle",
    min: 0.0,
    max: 1.0,
    step: 0.05,
    value: state.tracyWiggle ?? 0.5,
    format: v => `${Math.round(v * 100)}%`,
    onInput: v => { state.tracyWiggle = v; },
    tip: "Lateral sinusoidal swimming undulation amplitude"
  }));

  sectKinematics.appendChild(rowCurvSens);
  sectKinematics.appendChild(rowTailLen);
  sectKinematics.appendChild(rowWiggle);

  // Section C: Pitch & Gestural Actions
  const sectPitch = document.createElement("div");
  sectPitch.className = "chladni-card";
  sectPitch.innerHTML = `<div class="chladni-card-title">Pitch & Gestural Actions</div>`;

  const rowOctave = R("tracyOctave", knob({
    label: "Octave",
    min: -2,
    max: 2,
    step: 1,
    value: state.tracyOctave ?? 0,
    format: v => (v > 0 ? `+${v}` : `${v}`),
    onInput: v => { state.tracyOctave = Math.round(v); },
    tip: "Master octave transposition shift"
  }));

  const actionGroup = document.createElement("div");
  actionGroup.style.display = "flex";
  actionGroup.style.gap = "6px";
  actionGroup.style.marginTop = "8px";

  const btnReset = actionBtn("Reset Creature", () => {
    creatureS = 0.0;
    lastNoteIndex = -1;
    status("Tracy creature repositioned to ribbon start");
  }, "Reset creature to start of ribbon");

  const btnReverse = actionBtn("Reverse Path", () => {
    const reversed = [];
    for (let i = numCtrlPoints - 1; i >= 0; i--) {
      reversed.push({ x: ctrlX[i], y: ctrlY[i] });
    }
    setControlPoints(reversed);
    status("Ribbon traversal path direction reversed");
  }, "Invert ribbon traversal direction");

  actionGroup.appendChild(btnReset);
  actionGroup.appendChild(btnReverse);

  sectPitch.appendChild(rowOctave);
  sectPitch.appendChild(actionGroup);

  controlsGrid.appendChild(sectPath);
  controlsGrid.appendChild(sectKinematics);
  controlsGrid.appendChild(sectPitch);

  moduleWrap.appendChild(header);
  moduleWrap.appendChild(canvas);
  moduleWrap.appendChild(controlsGrid);
  container.appendChild(moduleWrap);

  // Initialize with active preset
  initTracyPreset(state.tracyPreset || "figure_eight");

  // Wire model hooks
  setModelGenerator("tracy_ribbon", generateTracyRibbonBank);
  setModelStepHandler("tracy_ribbon", () => {
    if (!isTracyPlaying) {
      stepSimulation(0.02);
    }
  });

  // Start rendering loop
  if (!animFrameId) {
    animFrameId = requestAnimationFrame(animLoop);
  }
}

/**
 * Refresh UI control widgets when state values update.
 */
function syncControls() {
  if (refs.tracySpeed) refs.tracySpeed.setValue(state.tracySpeed);
  if (refs.tracyDivs) refs.tracyDivs.setValue(state.tracyDivs);
  if (refs.tracyCurvSens) refs.tracyCurvSens.setValue(state.tracyCurvSens);
  if (refs.tracyTailLen) refs.tracyTailLen.setValue(state.tracyTailLen);
  if (refs.tracyOctave) refs.tracyOctave.setValue(state.tracyOctave);
  if (refs.tracyWiggle) refs.tracyWiggle.setValue(state.tracyWiggle);
  if (refs.tracyPreset) refs.tracyPreset.setValue(state.tracyPreset);
}

export function activateTracyRibbonModel() {
  if (container) container.style.display = "block";
  stopTracyRibbon();
  setModelTransportHandler({
    start: startTracyRibbon,
    stop: stopTracyRibbon,
    toggle: toggleTracyRibbonRunning,
    isRunning: isTracyRibbonRunning
  });
  renderCanvas();
  if (!animFrameId) {
    lastFrameTime = performance.now();
    animFrameId = requestAnimationFrame(animLoop);
  }
}

export function deactivateTracyRibbonModel() {
  stopTracyRibbon();
  setModelTransportHandler(null);
  if (container) container.style.display = "none";
  if (animFrameId) {
    cancelAnimationFrame(animFrameId);
    animFrameId = null;
  }
}

// Register Snapshot Serialization
registerModel({
  id: "tracy_ribbon",
  version: 1,
  capture: () => {
    const pts = [];
    for (let i = 0; i < numCtrlPoints; i++) {
      pts.push({ x: ctrlX[i], y: ctrlY[i] });
    }
    return {
      preset: state.tracyPreset,
      speed: state.tracySpeed,
      divs: state.tracyDivs,
      curvSens: state.tracyCurvSens,
      tailLen: state.tracyTailLen,
      octave: state.tracyOctave,
      wiggle: state.tracyWiggle,
      creatureS,
      points: pts
    };
  },
  restore: (data) => {
    if (!data) return;
    if (data.preset) state.tracyPreset = data.preset;
    if (data.speed !== undefined) state.tracySpeed = data.speed;
    if (data.divs !== undefined) state.tracyDivs = data.divs;
    if (data.curvSens !== undefined) state.tracyCurvSens = data.curvSens;
    if (data.tailLen !== undefined) state.tracyTailLen = data.tailLen;
    if (data.octave !== undefined) state.tracyOctave = data.octave;
    if (data.wiggle !== undefined) state.tracyWiggle = data.wiggle;
    if (data.creatureS !== undefined) creatureS = data.creatureS;
    if (data.points && Array.isArray(data.points) && data.points.length >= 3) {
      setControlPoints(data.points);
    } else {
      initTracyPreset(state.tracyPreset || "figure_eight");
    }
    syncControls();
  }
});
