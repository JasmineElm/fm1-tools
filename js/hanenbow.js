// hanenbow.js — Electroplankton Hanenbow Leaf Deflection Ballistics for FM-1 Pulses.
// Physical acoustic ballistics simulation inspired by Toshio Iwai's Electroplankton.
//
// Generative Architecture:
// 1. Spring-cannon launches plankton projectiles with Newtonian ballistics (gravity, launch angle, velocity).
// 2. Pond populated with up to 8 flexible leaves (strictly <= 8 voices for M-VAVE FM-1 hardware).
// 3. Circle-to-line segment collision detection with specular momentum rebound and leaf restitution.
// 4. Damped harmonic leaf spring oscillation with progressive bloom coloration upon impacts.
// 5. Scale-quantized bell and chime note triggers with velocity proportional to normal impact force.
// 6. Direct manipulation: drag leaf rotation handles, reposition leaves, and re-aim the launch cannon.
// 7. Continuous FM-1 CC #74 Brightness modulation driven by impact momentum and pond excitation.
// 8. Dual Sync/Free modes: 64-step transport-locked grid sequence or continuous real-time ballistics.

import {
  state, refs, R, setState, scheduleRegen, doGenerate,
  getBank, setBank, getSelected, setSelected, status, onRegen,
  setModelGenerator, setModelRandomizer, RATE_NAMES
} from "./state.js";
import { knob, dropdown, actionBtn } from "./controls.js";
import { isLive, setModelStepHandler, setModelTransportHandler } from "./player.js?v=1";
import { liveNoteOn, liveNoteOff, panicPreview } from "./player.js";
import { SCALE_LABELS, ROOT_NOTE_OPTIONS, ROOT_OCTAVE_OPTIONS, mapNormalizedToNote, getRootMidi, getActiveScaleIntervals, computeOctaveShift, createNotesSection } from "./scale.js?v=1";
import { syncRhythmGrid } from "./rhythm.js";
import { getActiveModel } from "./modes.js";
import { quantize, midiName, SCALES } from "./generator.js";
import { registerModel } from "./snapshot.js";
import { playVoice, releasePolyVoices } from "./poly.js";
import * as midi from "./midi.js";
import * as audio from "./audio.js";

// ---- Constants & Pre-allocated TypedArray Buffers (Zero GC Churn) ----
const MAX_LEAVES = 8;
const MAX_PLANKTON = 16;
const MAX_VOICES = 8;
const voiceSlots = new Array(MAX_LEAVES).fill(null); // active note per leaf

let forceRegenRhythm = false;

// Plankton Projectile Pool (TypedArrays for zero GC churn)
const pX = new Float32Array(MAX_PLANKTON);
const pY = new Float32Array(MAX_PLANKTON);
const pVx = new Float32Array(MAX_PLANKTON);
const pVy = new Float32Array(MAX_PLANKTON);
const pActive = new Uint8Array(MAX_PLANKTON);
const pRadius = 7.5;
const pColors = ["#00f0ff", "#39ff14", "#ffb700", "#ff007f", "#38bdf8", "#eab308"];

// Plankton tail trail buffers (last 6 positions per plankton)
const TRAIL_PTS = 6;
const pTrailX = new Float32Array(MAX_PLANKTON * TRAIL_PTS);
const pTrailY = new Float32Array(MAX_PLANKTON * TRAIL_PTS);

// Leaf Surface & Physics Buffers
const leafX = new Float32Array(MAX_LEAVES);
const leafY = new Float32Array(MAX_LEAVES);
const leafLength = new Float32Array(MAX_LEAVES);
const leafAngle = new Float32Array(MAX_LEAVES);
const leafBend = new Float32Array(MAX_LEAVES);
const leafBendVel = new Float32Array(MAX_LEAVES);
const leafBloom = new Float32Array(MAX_LEAVES); // 0.0 (green) -> 1.0 (bloomed amber/pink)
const leafPitchIdx = new Int32Array(MAX_LEAVES);

// Scale cycling state: tracks hit timestamps, decay, and cycle count per leaf
export const BASE_PERIOD_SEC = 5.0;
export const LEAF_INCREMENT_THRESHOLD = 1;

const leafLastHitTime = new Float64Array(MAX_LEAVES).fill(-999);
const leafLastDecayTime = new Float64Array(MAX_LEAVES).fill(-999);
const leafCycleCount = new Int32Array(MAX_LEAVES);

const MAX_HITS_PER_LEAF = 32;
const leafHitTimes = new Float64Array(MAX_LEAVES * MAX_HITS_PER_LEAF).fill(-999);
const leafHitIndices = new Int32Array(MAX_LEAVES);
const leafHitTotal = new Int32Array(MAX_LEAVES);

export function getLeafCycleCount(i) {
  return leafCycleCount[i];
}

export function setLeafCycleCount(i, count) {
  leafCycleCount[i] = count;
}

export function getLeafAssessedPeriod(i) {
  const userMult = Math.min(4.0, Math.max(0.25, Number(state.hanenbowTimingPeriod ?? 1.0)));
  const leafLen = leafLength[i] || 100;
  return BASE_PERIOD_SEC * userMult * (leafLen / 100.0);
}

function recordLeafHit(i, nowSec) {
  const idx = (leafHitIndices[i] + 1) % MAX_HITS_PER_LEAF;
  leafHitIndices[i] = idx;
  leafHitTimes[i * MAX_HITS_PER_LEAF + idx] = nowSec;
  if (leafHitTotal[i] < MAX_HITS_PER_LEAF) leafHitTotal[i]++;
  leafLastHitTime[i] = nowSec;
}

export function getLeafHitsInPeriod(i, period, nowSec) {
  const cutoff = nowSec - period;
  const base = i * MAX_HITS_PER_LEAF;
  const total = leafHitTotal[i];
  let count = 0;
  for (let k = 0; k < total; k++) {
    const t = leafHitTimes[base + k];
    if (t >= cutoff && t <= nowSec) {
      count++;
    }
  }
  return count;
}

export function updateLeafPitch(i, advance, nowSec = performance.now() * 0.001) {
  const period = getLeafAssessedPeriod(i);

  // 1. Process time-based pitch decay if hits dropped below 0.5 of increment threshold
  if (leafCycleCount[i] > 0) {
    const lastHitOrDecay = Math.max(leafLastHitTime[i], leafLastDecayTime[i]);
    const elapsed = nowSec - lastHitOrDecay;
    if (elapsed >= period) {
      // Check hits within the assessed period window
      const hitsInWindow = getLeafHitsInPeriod(i, period, nowSec);
      if (hitsInWindow < 0.5 * LEAF_INCREMENT_THRESHOLD) {
        const dropSteps = Math.min(leafCycleCount[i], Math.floor(elapsed / period));
        leafCycleCount[i] = Math.max(0, leafCycleCount[i] - dropSteps);
        leafLastDecayTime[i] = nowSec;
      }
    }
  }

  // 2. Process hit increment if a ball hit this leaf
  if (advance) {
    const elapsedSinceLastHit = nowSec - leafLastHitTime[i];
    if (elapsedSinceLastHit > 0.04 && elapsedSinceLastHit <= period) {
      leafCycleCount[i] += 1;
    }
    recordLeafHit(i, nowSec);
    leafLastDecayTime[i] = nowSec;
  }
}

// Leaf Dimensions & Uniform Line Width (Usable across screen sizes)
export const MIN_LEAF_LEN = 48; // minimum leaf length in reference units
export const MAX_LEAF_LEN = 240;
export const LEAF_LEN_DIVISOR = 6; // divisor on minimum length establishing common uniform width
export const LEAF_LINE_WIDTH = MIN_LEAF_LEN / LEAF_LEN_DIVISOR; // 8px uniform line width

export function getLeafLength(i) {
  return leafLength[i];
}

export function setLeafLength(i, len) {
  leafLength[i] = Math.max(MIN_LEAF_LEN, Math.min(MAX_LEAF_LEN, len));
}

// Cannon Launcher State & Bounds (Node is fully visible within canvas at all times)
export const CAN_PAD = 36;
export const CAN_MIN_X = CAN_PAD;
export const CAN_MAX_X = 800 - CAN_PAD;
export const CAN_MIN_Y = CAN_PAD;
export const CAN_MAX_Y = 540 - CAN_PAD;

let cannonX = 80;
let cannonY = 480;
let cannonAngle = -Math.PI / 3; // -60 degrees
let cannonSpeed = 650;
let cannonPulse = 0;
let fireTimer = 0;

export function getCannon() {
  return { x: cannonX, y: cannonY, angle: cannonAngle, speed: cannonSpeed };
}

export function setCannonPosition(x, y) {
  cannonX = Math.max(CAN_MIN_X, Math.min(CAN_MAX_X, x));
  cannonY = Math.max(CAN_MIN_Y, Math.min(CAN_MAX_Y, y));
}

let lastLiveStep = -1;
let animFrameId = null;
let lastFrameTime = 0;

// Transport & Autonomous Playback State
let isHanenbowPlaying = false;

export function isHanenbowRunning() {
  return isHanenbowPlaying;
}

export function startHanenbow() {
  if (isHanenbowPlaying) return;
  isHanenbowPlaying = true;
  audio.unlock();
  fireTimer = 0;
  firePlankton();
  status("Hanenbow: Playing · Ballistics leaf collision triggers", "ok");
}

export function stopHanenbow() {
  isHanenbowPlaying = false;
  releasePolyVoices();
  panicPreview();
  try { audio.allOff(); } catch (_) {}
  voiceSlots.fill(null);
  for (let i = 0; i < MAX_PLANKTON; i++) {
    pActive[i] = 0;
  }
  status("stopped");
}

export function toggleHanenbowRunning() {
  if (isHanenbowPlaying) {
    stopHanenbow();
    return false;
  } else {
    startHanenbow();
    return true;
  }
}

// Dragging & Interaction State
let isDragging = null; // null | { type: "leaf-angle"|"leaf-pos"|"cannon-angle"|"cannon-pos", idx: number }
let hoveredLeaf = -1;

// UI DOM references
let hanenbowContainer = null;
let pondCanvas = null;
let presetSelect = null;
let notesSection = null;

// Presets for classic pond layouts
export const HANENBOW_PRESETS = [
  {
    id: "cascade",
    name: "Waterfall Cascade",
    desc: "Staggered diagonal leaves funneling ricochets in descending/ascending arpeggio cascades",
    leaves: 5,
    cannon: { x: 75, y: 470, angle: -1.26, speed: 750 },
    leafData: [
      { x: 195, y: 325, len: 170, angle: -0.22, pitch: 0 },
      { x: 340, y: 250, len: 140, angle: -0.20, pitch: 2 },
      { x: 485, y: 220, len: 115, angle: -0.15, pitch: 4 },
      { x: 625, y: 280, len: 90,  angle: 0.35,  pitch: 5 },
      { x: 480, y: 410, len: 65,  angle: 0.20,  pitch: 7 }
    ],
    gravity: 860,
    elasticity: 0.98,
    fireRate: 1.6
  },
  {
    id: "fountain",
    name: "Acoustic Fountain",
    desc: "Symmetrical V-shaped bounce leaves returning plankton in tall parabolic ricochet arcs",
    leaves: 6,
    cannon: { x: 390, y: 490, angle: -1.68, speed: 720 },
    leafData: [
      { x: 270, y: 250, len: 160, angle: 0.45,  pitch: 4 },
      { x: 530, y: 250, len: 160, angle: -0.45, pitch: 4 },
      { x: 180, y: 360, len: 110, angle: 0.25,  pitch: 1 },
      { x: 620, y: 360, len: 110, angle: -0.25, pitch: 1 },
      { x: 330, y: 420, len: 75,  angle: -0.18, pitch: 6 },
      { x: 470, y: 420, len: 75,  angle: 0.18,  pitch: 6 }
    ],
    gravity: 920,
    elasticity: 0.96,
    fireRate: 1.4
  },
  {
    id: "pinball",
    name: "Pachinko Pinball",
    desc: "Alternating criss-cross leaves yielding syncopated polyrhythmic ricochets and double strikes",
    leaves: 7,
    cannon: { x: 90, y: 480, angle: -1.18, speed: 730 },
    leafData: [
      { x: 210, y: 250, len: 170, angle: 0.40,  pitch: 0 },
      { x: 380, y: 200, len: 145, angle: -0.45, pitch: 2 },
      { x: 550, y: 260, len: 125, angle: 0.38,  pitch: 4 },
      { x: 680, y: 370, len: 105, angle: -0.60, pitch: 6 },
      { x: 510, y: 380, len: 90,  angle: -0.30, pitch: 3 },
      { x: 340, y: 390, len: 75,  angle: 0.25,  pitch: 1 },
      { x: 200, y: 440, len: 60,  angle: -0.15, pitch: 5 }
    ],
    gravity: 920,
    elasticity: 0.96,
    fireRate: 1.8
  },
  {
    id: "belltree",
    name: "Resonant Bell Tree",
    desc: "Ascending ladder of leaves with tight micro-timing intervals and ascending melodic runs",
    leaves: 6,
    cannon: { x: 120, y: 500, angle: -1.25, speed: 720 },
    leafData: [
      { x: 240, y: 380, len: 180, angle: -0.22, pitch: 0 },
      { x: 360, y: 300, len: 155, angle: -0.25, pitch: 1 },
      { x: 480, y: 230, len: 130, angle: -0.22, pitch: 2 },
      { x: 600, y: 200, len: 105, angle: 0.30,  pitch: 3 },
      { x: 440, y: 150, len: 80,  angle: 0.35,  pitch: 5 },
      { x: 280, y: 220, len: 60,  angle: -0.28, pitch: 7 }
    ],
    gravity: 880,
    elasticity: 0.98,
    fireRate: 1.5
  },
  {
    id: "zen",
    name: "Zen Garden Chimes",
    desc: "Spacious, gentle shallow leaves for slow ambient ring-outs and peaceful water drop bounces",
    leaves: 4,
    cannon: { x: 100, y: 460, angle: -1.22, speed: 680 },
    leafData: [
      { x: 240, y: 340, len: 180, angle: -0.22, pitch: 0 },
      { x: 430, y: 280, len: 140, angle: -0.18, pitch: 2 },
      { x: 620, y: 330, len: 100, angle: 0.28,  pitch: 4 },
      { x: 400, y: 430, len: 70,  angle: 0.15,  pitch: 7 }
    ],
    gravity: 780,
    elasticity: 0.95,
    fireRate: 1.0
  }
];

// ---- Pond & Ballistics Initialization ----
export function initHanenbowSystem(presetId = state.hanenbowPreset || "cascade", preserveProjectiles = false) {
  const p = HANENBOW_PRESETS.find(pr => pr.id === presetId) || HANENBOW_PRESETS[0];
  const num = Math.min(MAX_LEAVES, Math.max(2, state.hanenbowLeaves ?? p.leaves));

  cannonX = p.cannon.x;
  cannonY = p.cannon.y;
  cannonAngle = p.cannon.angle;
  cannonSpeed = state.hanenbowLaunchSpeed ?? p.cannon.speed;

  for (let i = 0; i < MAX_LEAVES; i++) {
    if (i < num) {
      const ld = p.leafData[i] || { x: 200 + i * 70, y: 300 + (i % 2) * 60, len: 110, angle: 0.1, pitch: i };
      leafX[i] = ld.x;
      leafY[i] = ld.y;
      leafLength[i] = ld.len;
      leafAngle[i] = ld.angle;
      leafBend[i] = 0;
      leafBendVel[i] = 0;
      leafBloom[i] = 0;
      leafPitchIdx[i] = ld.pitch ?? i;
    } else {
      leafLength[i] = 0;
    }
    leafCycleCount[i] = 0;
    leafLastHitTime[i] = -999;
    leafLastDecayTime[i] = -999;
    leafHitTotal[i] = 0;
    leafHitIndices[i] = 0;
  }

  // Clear plankton projectile pool only if not preserving active balls during live playback
  if (!preserveProjectiles) {
    for (let i = 0; i < MAX_PLANKTON; i++) {
      pActive[i] = 0;
      pX[i] = 0;
      pY[i] = 0;
      pVx[i] = 0;
      pVy[i] = 0;
    }
  }
}

// Spawns a new plankton creature from the cannon
export function firePlankton() {
  let slot = -1;
  for (let i = 0; i < MAX_PLANKTON; i++) {
    if (pActive[i] === 0) { slot = i; break; }
  }
  if (slot === -1) slot = 0; // Recycle oldest

  pActive[slot] = 1;
  pX[slot] = cannonX + Math.cos(cannonAngle) * 22;
  pY[slot] = cannonY + Math.sin(cannonAngle) * 22;

  const spd = state.hanenbowLaunchSpeed ?? cannonSpeed;
  pVx[slot] = Math.cos(cannonAngle) * spd;
  pVy[slot] = Math.sin(cannonAngle) * spd;

  for (let t = 0; t < TRAIL_PTS; t++) {
    pTrailX[slot * TRAIL_PTS + t] = pX[slot];
    pTrailY[slot * TRAIL_PTS + t] = pY[slot];
  }

  cannonPulse = 1.0;
}

// ---- Audio Dispatch & Voice Slot Management (Strict 8-Voice Ceiling via js/poly.js) ----
function playLeafVoice(leafIdx, note, vel, durMs) {
  playVoice(leafIdx, note, vel, durMs);
  voiceSlots[leafIdx] = note;
}

// Resolves a scale-quantized pitch for leaf `i`.
// Base pitch is inversely proportional to leaf size: larger leaves are pitched lower.
// All pitches are strictly constrained within the Octave Spread value.
// If `advance` is true and hit within `hanenbowTimingPeriod`, cycles upward through the scale.
export function getLeafNote(i, advance = false, nowSec = performance.now() * 0.001) {
  const intervals = getActiveScaleIntervals();
  const root = getRootMidi();
  // Constrain strictly to the Octave spread value (1..4 octaves)
  const span = Math.min(4, Math.max(1, Number(state.hanenbowSpan ?? state.pitchSpan ?? 2)));

  updateLeafPitch(i, advance, nowSec);

  // Base pitch mapping: larger leaves are pitched lower!
  // Length ranges from MIN_LEAF_LEN (smallest/highest) to MAX_LEAF_LEN (largest/lowest)
  const len = Math.max(MIN_LEAF_LEN, Math.min(MAX_LEAF_LEN, leafLength[i]));
  const normSize = (len - MIN_LEAF_LEN) / (MAX_LEAF_LEN - MIN_LEAF_LEN); // 0.0 (smallest) to 1.0 (largest)

  // Total in-scale notes strictly spanning the Octave Spread (including top octave root)
  const numIntervals = Math.max(1, intervals.length);
  const totalDegrees = span * numIntervals + 1;

  // Base degree from leaf size: larger leaf = lower degree within octave spread
  const normPitch = 1.0 - normSize; // 1.0 = smallest (highest), 0.0 = largest (lowest)
  const baseDeg = Math.round(normPitch * (totalDegrees - 1));

  // Cycling upwards upon repeated hits within assessed period:
  // Strictly constrained to the Octave spread value by wrapping within [0, totalDegrees - 1]
  const activeCycle = leafCycleCount[i];
  const constrainedDeg = (baseDeg + activeCycle) % totalDegrees;

  // Compute direction-adjusted base root according to Spread Direction
  const dir = (state.octaveMode || "up").toLowerCase();
  let baseRoot = root;
  if (dir === "down") {
    baseRoot = root - span * 12;
  } else if (dir === "both") {
    baseRoot = root - Math.floor(span / 2) * 12;
  }

  const octaveOffset = Math.floor(constrainedDeg / numIntervals);
  const scaleDeg = constrainedDeg % numIntervals;
  const rawNote = baseRoot + octaveOffset * 12 + (intervals[scaleDeg] || 0);

  // Strict boundary clamp ensuring notes never exceed the Octave Spread window
  const minAllowed = Math.max(0, baseRoot);
  const maxAllowed = Math.min(127, baseRoot + span * 12);
  const boundedNote = Math.max(minAllowed, Math.min(maxAllowed, rawNote));

  return quantize(boundedNote, intervals, root);
}

// Helper: Compute outward surface normal for leaf collision
function getLeafNormal(px, py, closeX, closeY, ang, u, dist) {
  const cosA = Math.cos(ang);
  const sinA = Math.sin(ang);
  if (u > 0.08 && u < 0.92) {
    let nx = -sinA;
    let ny = cosA;
    if ((px - closeX) * nx + (py - closeY) * ny < 0) {
      nx = -nx;
      ny = -ny;
    }
    return { nx, ny };
  } else {
    const dx = px - closeX;
    const dy = py - closeY;
    if (dist > 0.001) {
      return { nx: dx / dist, ny: dy / dist };
    }
    let nx = -sinA;
    let ny = cosA;
    if (ny > 0) {
      nx = -nx;
      ny = -ny;
    }
    return { nx, ny };
  }
}

// ---- Ballistics & Physics Step ----
function stepBallistics(dt) {
  const num = Math.min(MAX_LEAVES, Math.max(2, state.hanenbowLeaves ?? 5));
  const grav = state.hanenbowGravity ?? 880;
  const rest = state.hanenbowElasticity ?? 0.96;
  const subSteps = 5;
  const sdt = dt / subSteps;

  for (let sub = 0; sub < subSteps; sub++) {
    // 1. Advance plankton projectiles
    for (let p = 0; p < MAX_PLANKTON; p++) {
      if (pActive[p] === 0) continue;

      pVy[p] += grav * sdt;
      pX[p] += pVx[p] * sdt;
      pY[p] += pVy[p] * sdt;

      // Check bounds: fall below pond water level (Y > 580) or off-screen
      if (pX[p] < -40 || pX[p] > 860 || pY[p] > 580) {
        pActive[p] = 0;
        continue;
      }

      // 2. Collision with leaves (Circle-to-Line Segment deflection)
      for (let j = 0; j < num; j++) {
        const lx = leafX[j];
        const ly = leafY[j];
        const len = leafLength[j];
        const ang = leafAngle[j] + leafBend[j];

        const cosA = Math.cos(ang);
        const sinA = Math.sin(ang);
        const halfL = len * 0.5;

        const segP1x = lx - cosA * halfL;
        const segP1y = ly - sinA * halfL;
        const segDx = cosA * len;
        const segDy = sinA * len;
        const segLenSq = len * len;

        const u = Math.max(0, Math.min(1, ((pX[p] - segP1x) * segDx + (pY[p] - segP1y) * segDy) / segLenSq));
        const closeX = segP1x + u * segDx;
        const closeY = segP1y + u * segDy;
        const dist = Math.hypot(pX[p] - closeX, pY[p] - closeY);
        const hitDist = pRadius + LEAF_LINE_WIDTH * 0.5;

        if (dist < hitDist) {
          const { nx, ny } = getLeafNormal(pX[p], pY[p], closeX, closeY, ang, u, dist);
          const dot = pVx[p] * nx + pVy[p] * ny;

          if (dot < 0) {
            // Specular rebound with restitution
            pVx[p] -= (1 + rest) * dot * nx;
            pVy[p] -= (1 + rest) * dot * ny;

            // Push plankton cleanly off surface to prevent collision sticking
            pX[p] = closeX + nx * (hitDist + 0.6);
            pY[p] = closeY + ny * (hitDist + 0.6);

            // Leaf spring elastic impulse & bloom
            leafBendVel[j] += dot * 0.0009;
            leafBloom[j] = Math.min(1.0, leafBloom[j] + 0.40);

            // Trigger leaf sound (cycles upward through scale if hit within timing period)
            const nowSec = performance.now() * 0.001;
            const note = getLeafNote(j, true, nowSec);
            const vel = Math.min(127, Math.max(40, Math.round(Math.abs(dot) * 0.22)));
            const gateLen = state.hanenbowGateLen ?? 240;
            playLeafVoice(j, note, vel, gateLen);
          }
        }
      }
    }
  }

  // Shift tail trail once per frame
  for (let p = 0; p < MAX_PLANKTON; p++) {
    if (pActive[p] === 0) continue;
    for (let t = TRAIL_PTS - 1; t > 0; t--) {
      pTrailX[p * TRAIL_PTS + t] = pTrailX[p * TRAIL_PTS + t - 1];
      pTrailY[p * TRAIL_PTS + t] = pTrailY[p * TRAIL_PTS + t - 1];
    }
    pTrailX[p * TRAIL_PTS] = pX[p];
    pTrailY[p * TRAIL_PTS] = pY[p];
  }

  // 3. Update leaf spring damped oscillations & pitch decay
  const omega0 = 24.0; // natural spring frequency
  const zeta = 0.22;   // damping ratio
  const nowSec = performance.now() * 0.001;
  for (let j = 0; j < num; j++) {
    const accel = -omega0 * omega0 * leafBend[j] - 2 * zeta * omega0 * leafBendVel[j];
    leafBendVel[j] += accel * dt;
    leafBend[j] += leafBendVel[j] * dt;
    leafBloom[j] = Math.max(0.0, leafBloom[j] - dt * 0.4); // bloom decay
    updateLeafPitch(j, false, nowSec);
  }

  if (cannonPulse > 0.01) {
    cannonPulse *= 0.90;
  } else {
    cannonPulse = 0;
  }
}

// ---- Continuous Free Animation Loop ----
function freeLoop(time) {
  const dt = Math.min(0.05, (time - lastFrameTime) / 1000) || 0.016;
  lastFrameTime = time;

  const speedMult = Math.max(0.1, Number(state.modelSpeed ?? 1.0));

  // Run cannon trigger clock and step ballistics when transport is playing
  if (isHanenbowPlaying) {
    const fireInterval = 1.0 / (Math.max(0.1, state.hanenbowFireRate ?? 1.5) * speedMult);
    fireTimer += dt;
    if (fireTimer >= fireInterval) {
      fireTimer = 0;
      firePlankton();
    }
    stepBallistics(dt * speedMult);
  }

  renderPondCanvas();
  animFrameId = requestAnimationFrame(freeLoop);
}

// Retained for interface compatibility; note triggers are based solely on leaf collisions
export function onHanenbowLiveStep(step) {}

// ---- Bank Generator Contract (`return bank`) ----
// Note triggering is based solely on physical leaf collisions; bank steps contain no step-clock notes.
export function generateHanenbowBank(st = state) {
  const seqLen = Math.max(1, Math.min(64, st?.length || 16));
  const rateIdx = typeof st?.rate === "number" ? st.rate : (RATE_NAMES.indexOf(st?.rate) >= 0 ? RATE_NAMES.indexOf(st?.rate) : 6);
  const bank = [];

  for (let s = 0; s < 16; s++) {
    const steps = [];
    for (let step = 0; step < seqLen; step++) {
      steps.push({
        notes: [],
        rate: rateIdx,
        gate: false
      });
    }
    bank.push({
      length: seqLen,
      rate: rateIdx,
      steps
    });
  }

  setBank(bank);
  return bank;
}

export function randomizeHanenbow() {
  const p = HANENBOW_PRESETS[Math.floor(Math.random() * HANENBOW_PRESETS.length)];
  state.hanenbowPreset = p.id;
  state.hanenbowLeaves = p.leaves;
  state.hanenbowGravity = p.gravity;
  state.hanenbowElasticity = 0.75 + Math.random() * 0.2;
  state.hanenbowFireRate = 1.0 + Math.random() * 1.5;
  state.hanenbowLaunchSpeed = 580 + Math.random() * 200;

  initHanenbowSystem(p.id);
  syncControlsFromState();
  forceRegenRhythm = true;
  doGenerate(true);
  forceRegenRhythm = false;
  syncRhythmGrid();
  status(`Randomized Hanenbow: ${p.name}`, "ok");
}

export function syncHanenbowFromRegen() {
  syncControlsFromState();
  renderPondCanvas();
}

// ---- Canvas Rendering & Direct Manipulation ----
function renderPondCanvas() {
  if (!pondCanvas) return;
  const ctx = pondCanvas.getContext("2d");
  if (!ctx) return;

  const w = pondCanvas.width = pondCanvas.clientWidth * (window.devicePixelRatio || 1);
  const h = pondCanvas.height = pondCanvas.clientHeight * (window.devicePixelRatio || 1);
  ctx.clearRect(0, 0, w, h);
  const nowMs = performance.now();

  // Read semantic workbench tokens dynamically
  const style = getComputedStyle(document.documentElement);
  const colBg = style.getPropertyValue("--panel").trim() || "#18191f";
  const colPanel2 = style.getPropertyValue("--panel2").trim() || "#22252e";
  const colLine = style.getPropertyValue("--line").trim() || "#333846";
  const colLineFocus = style.getPropertyValue("--line-focus").trim() || "#4b5264";
  const colAccent = style.getPropertyValue("--accent").trim() || "#3b82f6";
  const colAccent2 = style.getPropertyValue("--accent2").trim() || "#60a5fa";
  const colDim = style.getPropertyValue("--dim").trim() || "#9ca3af";
  const colFg = style.getPropertyValue("--fg").trim() || "#f3f4f6";
  const colOk = style.getPropertyValue("--ok").trim() || "#22c55e";

  const num = Math.min(MAX_LEAVES, Math.max(2, state.hanenbowLeaves ?? 5));
  const scaleX = w / 800.0;
  const scaleY = h / 540.0;

  // 1. Draw pond waterline bottom
  const waterY = 510 * scaleY;
  ctx.fillStyle = colPanel2;
  ctx.fillRect(0, waterY, w, h - waterY);
  ctx.lineWidth = 1;
  ctx.strokeStyle = colLine;
  ctx.beginPath();
  ctx.moveTo(0, waterY);
  ctx.lineTo(w, waterY);
  ctx.stroke();

  // 2. Draw leaves and rotation handles
  for (let i = 0; i < num; i++) {
    const lx = leafX[i] * scaleX;
    const ly = leafY[i] * scaleY;
    const len = leafLength[i] * scaleX;
    const ang = leafAngle[i] + leafBend[i];
    const halfL = len * 0.5;

    const cosA = Math.cos(ang);
    const sinA = Math.sin(ang);
    const p1x = lx - cosA * halfL;
    const p1y = ly - sinA * halfL;
    const p2x = lx + cosA * halfL;
    const p2y = ly + sinA * halfL;

    // Leaf coloration: green base blooming to vibrant pink/amber upon hits
    const bloom = leafBloom[i];
    const isSelected = (hoveredLeaf === i || (isDragging && isDragging.idx === i));
    const rCol = Math.round(34 + bloom * (244 - 34));
    const gCol = Math.round(197 - bloom * (197 - 63));
    const bCol = Math.round(94 + bloom * (94 - 94));
    const leafFillColor = `rgb(${rCol}, ${gCol}, ${bCol})`;

    // Draw leaf body (common uniform line width irrespective of length, usable on small screens)
    const leafThick = Math.max(3.5, LEAF_LINE_WIDTH * scaleY);
    ctx.lineWidth = leafThick;
    ctx.lineCap = "round";
    ctx.strokeStyle = leafFillColor;
    ctx.beginPath();
    ctx.moveTo(p1x, p1y);
    ctx.lineTo(p2x, p2y);
    ctx.stroke();

    // Leaf outline
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = isSelected ? "#ffffff" : colLineFocus;
    ctx.stroke();

    // Leaf center pivot node (for translation)
    ctx.fillStyle = isSelected ? "#ffffff" : colBg;
    ctx.beginPath();
    ctx.arc(lx, ly, 4 * scaleX, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = colLineFocus;
    ctx.stroke();

    // Outer tip (p2) resize & rotation handle
    ctx.fillStyle = (isSelected || (isDragging && isDragging.idx === i)) ? colAccent : colPanel2;
    ctx.beginPath();
    ctx.arc(p2x, p2y, 5.5 * scaleX, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = (isSelected || (isDragging && isDragging.idx === i)) ? "#ffffff" : colLineFocus;
    ctx.stroke();

    // Inner tip (p1) resize & rotation handle
    ctx.fillStyle = (isSelected || (isDragging && isDragging.idx === i)) ? colAccent : colPanel2;
    ctx.beginPath();
    ctx.arc(p1x, p1y, 4.5 * scaleX, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = (isSelected || (isDragging && isDragging.idx === i)) ? "#ffffff" : colLineFocus;
    ctx.stroke();

    // Leaf pitch & index label with scale cycling status
    const nowSec = nowMs * 0.001;
    const curNote = getLeafNote(i, false, nowSec);
    const noteNameStr = midiName(curNote);
    const isCycling = leafCycleCount[i] > 0;
    const cycleLabel = isCycling ? `L${i + 1} ${noteNameStr} +${leafCycleCount[i]}` : `L${i + 1} ${noteNameStr}`;

    ctx.fillStyle = isCycling ? colAccent : colFg;
    ctx.font = `bold ${Math.round(9 * scaleX)}px monospace`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(cycleLabel, lx, ly - (12 + leafThick * 0.5) * scaleY);
  }

  // 3. Draw Cannon launcher
  const cx = cannonX * scaleX;
  const cy = cannonY * scaleY;
  const cPulseRadius = (16 + cannonPulse * 8) * scaleX;

  // Cannon base
  ctx.fillStyle = colPanel2;
  ctx.beginPath();
  ctx.arc(cx, cy, 14 * scaleX, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = colLineFocus;
  ctx.stroke();

  // Cannon firing pulse ring
  if (cannonPulse > 0.05) {
    ctx.strokeStyle = colAccent;
    ctx.lineWidth = 2 * scaleX;
    ctx.globalAlpha = cannonPulse;
    ctx.beginPath();
    ctx.arc(cx, cy, cPulseRadius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1.0;
  }

  // Cannon barrel
  const barrelLen = (24 + cannonPulse * 6) * scaleX;
  const bx = cx + Math.cos(cannonAngle) * barrelLen;
  const by = cy + Math.sin(cannonAngle) * barrelLen;
  ctx.lineWidth = 8 * scaleX;
  ctx.lineCap = "round";
  ctx.strokeStyle = colAccent;
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(bx, by);
  ctx.stroke();

  // Cannon barrel tip
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(bx, by, 3 * scaleX, 0, Math.PI * 2);
  ctx.fill();

  // Cannon launch label (placed cleanly above or below depending on shooting angle)
  ctx.fillStyle = colAccent;
  ctx.font = `bold ${Math.round(9 * scaleX)}px monospace`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const labelOffsetY = (Math.sin(cannonAngle) > 0.3 && cy > 35 * scaleY) ? -22 : 22;
  ctx.fillText("LAUNCH", cx, cy + labelOffsetY * scaleY);

  // Cannon aiming trajectory guide arc (shows launch arc and multi-leaf deflections)
  ctx.save();
  ctx.strokeStyle = "rgba(0, 240, 255, 0.45)";
  ctx.lineWidth = 1.5;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  let arcX = cannonX;
  let arcY = cannonY;
  const spd = state.hanenbowLaunchSpeed ?? cannonSpeed;
  let arcVx = Math.cos(cannonAngle) * spd;
  let arcVy = Math.sin(cannonAngle) * spd;
  const grav = state.hanenbowGravity ?? 880;
  const rest = Math.min(1.0, state.hanenbowElasticity ?? 0.96);
  const stepT = 0.016;
  const guideHitDist = pRadius + LEAF_LINE_WIDTH * 0.5;
  ctx.moveTo(arcX * scaleX, arcY * scaleY);
  for (let s = 0; s < 70; s++) {
    arcVy += grav * stepT;
    arcX += arcVx * stepT;
    arcY += arcVy * stepT;
    if (arcY > 540 || arcX < -20 || arcX > 820) break;

    // Check collision with leaves
    for (let j = 0; j < num; j++) {
      const lx = leafX[j];
      const ly = leafY[j];
      const len = leafLength[j];
      const ang = leafAngle[j] + leafBend[j];

      const cosA = Math.cos(ang);
      const sinA = Math.sin(ang);
      const halfL = len * 0.5;

      const segP1x = lx - cosA * halfL;
      const segP1y = ly - sinA * halfL;
      const segDx = cosA * len;
      const segDy = sinA * len;
      const segLenSq = len * len;

      const u = Math.max(0, Math.min(1, ((arcX - segP1x) * segDx + (arcY - segP1y) * segDy) / segLenSq));
      const closeX = segP1x + u * segDx;
      const closeY = segP1y + u * segDy;
      const dist = Math.hypot(arcX - closeX, arcY - closeY);

      if (dist < guideHitDist) {
        const { nx, ny } = getLeafNormal(arcX, arcY, closeX, closeY, ang, u, dist);
        const dot = arcVx * nx + arcVy * ny;

        if (dot < 0) {
          arcVx -= (1 + rest) * dot * nx;
          arcVy -= (1 + rest) * dot * ny;
          arcX = closeX + nx * (guideHitDist + 0.6);
          arcY = closeY + ny * (guideHitDist + 0.6);
          break;
        }
      }
    }
    ctx.lineTo(arcX * scaleX, arcY * scaleY);
  }
  ctx.stroke();
  ctx.restore();

  // 4. Draw Plankton circle icons
  for (let p = 0; p < MAX_PLANKTON; p++) {
    if (pActive[p] === 0) continue;

    const px = pX[p] * scaleX;
    const py = pY[p] * scaleY;
    const col = pColors[p % pColors.length];
    const r = Math.max(5.5, Math.min(10, pRadius * scaleX * 1.1));

    // Trailing motion wake
    ctx.save();
    ctx.lineWidth = 2.5 * scaleX;
    ctx.lineCap = "round";
    ctx.strokeStyle = col;
    ctx.globalAlpha = 0.45;
    ctx.beginPath();
    ctx.moveTo(px, py);
    for (let t = 0; t < TRAIL_PTS; t++) {
      ctx.lineTo(pTrailX[p * TRAIL_PTS + t] * scaleX, pTrailY[p * TRAIL_PTS + t] * scaleY);
    }
    ctx.stroke();
    ctx.restore();

    // Simple circle icon
    ctx.beginPath();
    ctx.arc(px, py, r, 0, Math.PI * 2);
    ctx.fillStyle = col;
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = "#ffffff";
    ctx.stroke();
  }
}

function syncControlsFromState() {
  if (refs.hanenbowLeaves?.setValue) refs.hanenbowLeaves.setValue(state.hanenbowLeaves, false);
  if (refs.hanenbowGravity?.setValue) refs.hanenbowGravity.setValue(state.hanenbowGravity, false);
  if (refs.hanenbowElasticity?.setValue) refs.hanenbowElasticity.setValue(state.hanenbowElasticity, false);
  if (refs.hanenbowFireRate?.setValue) refs.hanenbowFireRate.setValue(state.hanenbowFireRate, false);
  if (refs.hanenbowLaunchSpeed?.setValue) refs.hanenbowLaunchSpeed.setValue(state.hanenbowLaunchSpeed, false);
  if (refs.hanenbowTimingPeriod?.setValue) refs.hanenbowTimingPeriod.setValue(state.hanenbowTimingPeriod, false);
  if (refs.hanenbowGateLen?.setValue) refs.hanenbowGateLen.setValue(state.hanenbowGateLen, false);
  if (refs.hanenbowSpan?.setValue) refs.hanenbowSpan.setValue(String(state.hanenbowSpan ?? state.pitchSpan ?? 2), false);
  if (presetSelect) presetSelect.value = state.hanenbowPreset || "cascade";
  if (notesSection?.sync) notesSection.sync();
}

// ---- UI Assembly & Model Initialization ----
export function initHanenbow() {
  hanenbowContainer = document.getElementById("model-hanenbow");
  if (!hanenbowContainer) return;
  hanenbowContainer.innerHTML = "";

  const layout = document.createElement("div");
  layout.className = "layout hanenbow-layout";

  // --- Left Column: Controls & Presets ---
  const module = document.createElement("div");
  module.className = "module hanenbow-module";

  // Card 1: Header, Transport, and Actions
  const headerCard = document.createElement("div");
  headerCard.className = "card";
  headerCard.style.padding = "8px 12px";

  const topRow = document.createElement("div");
  topRow.style.display = "flex";
  topRow.style.alignItems = "center";
  topRow.style.justifyContent = "space-between";

  const titleGroup = document.createElement("div");
  titleGroup.innerHTML = `<h3 style="margin:0; font-size:11px; font-weight:700; color:var(--accent); letter-spacing:1px; text-transform:uppercase;">Hanenbow Ballistics</h3>`;

  const actionsGroup = document.createElement("div");
  actionsGroup.style.display = "flex";
  actionsGroup.style.gap = "4px";

  const btnFire = document.createElement("button");
  btnFire.className = "btn-action";
  btnFire.style.fontSize = "10px";
  btnFire.style.padding = "3px 8px";
  btnFire.textContent = "Launch";
  btnFire.title = "Launch a projectile from the cannon (or click canvas launch node)";
  btnFire.addEventListener("click", () => {
    firePlankton();
    renderPondCanvas();
  });

  actionsGroup.append(btnFire);
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
  presetLabel.textContent = "POND:";

  presetSelect = document.createElement("select");
  presetSelect.className = "lsystem-select";
  presetSelect.style.flex = "1";
  for (const pr of HANENBOW_PRESETS) {
    const opt = document.createElement("option");
    opt.value = pr.id;
    opt.textContent = pr.name;
    opt.title = pr.desc;
    presetSelect.appendChild(opt);
  }
  presetSelect.value = state.hanenbowPreset || "cascade";
  presetSelect.addEventListener("change", (e) => {
    const pid = e.target.value;
    state.hanenbowPreset = pid;
    const p = HANENBOW_PRESETS.find(pr => pr.id === pid);
    if (p) {
      state.hanenbowLeaves = p.leaves;
      state.hanenbowGravity = p.gravity;
      state.hanenbowElasticity = p.elasticity;
      state.hanenbowFireRate = p.fireRate;
      initHanenbowSystem(pid, isHanenbowPlaying);
      syncControlsFromState();
      renderPondCanvas();
      status(`Hanenbow layout: ${p.name}`, "ok");
    }
  });

  presetRow.append(presetLabel, presetSelect);
  headerCard.append(topRow, presetRow);

  // Card 2: Ballistics Parameters
  const paramCard = document.createElement("div");
  paramCard.className = "card";
  paramCard.style.padding = "8px 12px";
  paramCard.style.marginTop = "8px";

  const paramGrid = document.createElement("div");
  paramGrid.className = "lsystem-param-grid";

  const kLeaves = knob({
    label: "LEAVES",
    min: 2, max: 8, step: 1,
    value: state.hanenbowLeaves ?? 5,
    unit: "",
    title: "Number of active acoustic leaves (strictly <= 8 voices)",
    onChange: (v) => {
      state.hanenbowLeaves = Math.round(v);
      const p = HANENBOW_PRESETS.find(pr => pr.id === (state.hanenbowPreset || "cascade")) || HANENBOW_PRESETS[0];
      for (let i = 0; i < state.hanenbowLeaves; i++) {
        if (leafLength[i] <= 0) {
          const ld = p.leafData[i] || { x: 200 + i * 70, y: 300 + (i % 2) * 60, len: 110, angle: 0.1, pitch: i };
          leafX[i] = ld.x;
          leafY[i] = ld.y;
          leafLength[i] = ld.len;
          leafAngle[i] = ld.angle;
        }
      }
      renderPondCanvas();
    }
  });
  R("hanenbowLeaves", kLeaves);

  const kGrav = knob({
    label: "GRAVITY",
    min: 300, max: 1800, step: 50,
    value: state.hanenbowGravity ?? 980,
    unit: "",
    title: "Downward gravity acceleration",
    onChange: (v) => {
      state.hanenbowGravity = v;
      renderPondCanvas();
    }
  });
  R("hanenbowGravity", kGrav);

  const kElast = knob({
    label: "BOUNCE",
    min: 0.50, max: 1.15, step: 0.02,
    value: state.hanenbowElasticity ?? 0.96,
    unit: "e",
    title: "Specular restitution coefficient of leaves",
    onChange: (v) => {
      state.hanenbowElasticity = v;
      renderPondCanvas();
    }
  });
  R("hanenbowElasticity", kElast);

  const kTrigSpeed = knob({
    label: "TRIG SPD",
    min: 0.2, max: 8.0, step: 0.1,
    value: state.hanenbowFireRate ?? 1.5,
    unit: "Hz",
    title: "Overall speed of cannon ball triggers (controllable live while running)",
    onChange: (v) => {
      state.hanenbowFireRate = v;
      status(`Trigger speed: ${v.toFixed(1)} Hz`, "ok");
    }
  });
  R("hanenbowFireRate", kTrigSpeed);

  const kLaunchSpeed = knob({
    label: "VELOCITY",
    min: 300, max: 950, step: 25,
    value: state.hanenbowLaunchSpeed ?? 650,
    unit: "",
    title: "Cannon launch velocity magnitude",
    onChange: (v) => {
      state.hanenbowLaunchSpeed = v;
      cannonSpeed = v;
      renderPondCanvas();
    }
  });
  R("hanenbowLaunchSpeed", kLaunchSpeed);

  const kPeriod = knob({
    label: "PERIOD",
    min: 0.25, max: 4.0, step: 0.25,
    value: state.hanenbowTimingPeriod ?? 1.0,
    unit: "x",
    title: "Assessed period multiplier (0.25x - 4x): base 5s * control * (leaf length / 100)",
    onChange: (v) => {
      state.hanenbowTimingPeriod = v;
      renderPondCanvas();
    }
  });
  R("hanenbowTimingPeriod", kPeriod);

  const kGate = knob({
    label: "GATE",
    min: 50, max: 800, step: 10,
    value: state.hanenbowGateLen ?? 240,
    unit: "ms",
    title: "Note duration (gate length) in milliseconds",
    onChange: (v) => {
      state.hanenbowGateLen = v;
    }
  });
  R("hanenbowGateLen", kGate);

  paramGrid.append(kLeaves, kGrav, kElast, kTrigSpeed, kLaunchSpeed, kPeriod, kGate);
  paramCard.appendChild(paramGrid);

  // Card 3: Notes & Scale Controls
  notesSection = createNotesSection({
    pitchSpanKey: "hanenbowSpan",
    defaultPitchSpan: 2,
    onChange: () => {
      state.pitchSpan = state.hanenbowSpan;
      renderPondCanvas();
    }
  });
  notesSection.sectEl.classList.add("card");
  notesSection.sectEl.style.padding = "8px 12px";
  notesSection.sectEl.style.marginTop = "8px";

  module.append(headerCard, paramCard, notesSection.sectEl);

  // --- Right Column: Interactive Pond Canvas ---
  const display = document.createElement("div");
  display.className = "display hanenbow-display";

  const canvasCard = document.createElement("div");
  canvasCard.className = "card hanenbow-canvas-card";
  canvasCard.style.padding = "8px 12px";

  const canvasHeader = document.createElement("div");
  canvasHeader.style.display = "flex";
  canvasHeader.style.justifyContent = "space-between";
  canvasHeader.style.alignItems = "center";
  canvasHeader.style.marginBottom = "6px";
  canvasHeader.innerHTML = `
    <span style="font-size:10px; font-weight:700; color:var(--fg); letter-spacing:1px; text-transform:uppercase;">Pond Ballistics &amp; Leaf Ricochet Matrix</span>
    <span style="font-size:9px; color:var(--dim);">Click launch node to fire · Drag to aim · Drag leaf tips to resize/rotate</span>
  `;

  pondCanvas = document.createElement("canvas");
  pondCanvas.className = "hanenbow-canvas";
  pondCanvas.style.width = "100%";
  pondCanvas.style.height = "320px";
  pondCanvas.style.display = "block";
  pondCanvas.style.borderRadius = "4px";
  pondCanvas.style.cursor = "crosshair";

  // Coordinate mapper from canvas pixels to pond reference space (800 x 540)
  const getCanvasCoords = (e) => {
    const rect = pondCanvas.getBoundingClientRect();
    const scaleX = 800.0 / rect.width;
    const scaleY = 540.0 / rect.height;
    return {
      mx: (e.clientX - rect.left) * scaleX,
      my: (e.clientY - rect.top) * scaleY
    };
  };

  pondCanvas.addEventListener("pointerdown", (e) => {
    const { mx, my } = getCanvasCoords(e);
    const num = Math.min(MAX_LEAVES, Math.max(2, state.hanenbowLeaves ?? 5));
    isDragging = null;

    // Check click on cannon launch node:
    // Outer tip handle aims angle; Base/body drags to position anywhere on canvas
    const distBase = Math.hypot(mx - cannonX, my - cannonY);
    const barrelTipX = cannonX + Math.cos(cannonAngle) * 24;
    const barrelTipY = cannonY + Math.sin(cannonAngle) * 24;
    const distTip = Math.hypot(mx - barrelTipX, my - barrelTipY);

    if (distTip < 16) {
      isDragging = { type: "cannon-angle", startMx: mx, startMy: my, moved: false };
      pondCanvas.setPointerCapture(e.pointerId);
      renderPondCanvas();
      return;
    }

    if (distBase < 28 || (Math.abs(mx - cannonX) < 26 && Math.abs(my - cannonY) < 32)) {
      isDragging = {
        type: "cannon-pos",
        startMx: mx,
        startMy: my,
        offsetX: cannonX - mx,
        offsetY: cannonY - my,
        moved: false
      };
      pondCanvas.setPointerCapture(e.pointerId);
      renderPondCanvas();
      return;
    }

    // Check hit test on leaf rotation/resize tip handles or leaf center
    for (let i = 0; i < num; i++) {
      const lx = leafX[i];
      const ly = leafY[i];
      const len = leafLength[i];
      const ang = leafAngle[i];
      const cosA = Math.cos(ang);
      const sinA = Math.sin(ang);
      const halfL = len * 0.5;

      const p2x = lx + cosA * halfL;
      const p2y = ly + sinA * halfL;
      const p1x = lx - cosA * halfL;
      const p1y = ly - sinA * halfL;

      // Handle tip 2 (outer tip) resize & rotate
      if (Math.hypot(mx - p2x, my - p2y) < 22) {
        isDragging = { type: "leaf-tip2", idx: i };
        pondCanvas.setPointerCapture(e.pointerId);
        return;
      }

      // Handle tip 1 (inner tip) resize & rotate
      if (Math.hypot(mx - p1x, my - p1y) < 22) {
        isDragging = { type: "leaf-tip1", idx: i };
        pondCanvas.setPointerCapture(e.pointerId);
        return;
      }

      // Handle leaf center translation
      if (Math.hypot(mx - lx, my - ly) < 24) {
        isDragging = { type: "leaf-pos", idx: i };
        pondCanvas.setPointerCapture(e.pointerId);
        return;
      }
    }
  });

  pondCanvas.addEventListener("pointermove", (e) => {
    const { mx, my } = getCanvasCoords(e);
    const num = Math.min(MAX_LEAVES, Math.max(2, state.hanenbowLeaves ?? 5));

    if (isDragging) {
      if (isDragging.type === "leaf-tip2") {
        const i = isDragging.idx;
        const dx = mx - leafX[i];
        const dy = my - leafY[i];
        const dist = Math.hypot(dx, dy);
        leafLength[i] = Math.max(MIN_LEAF_LEN, Math.min(MAX_LEAF_LEN, dist * 2));
        leafAngle[i] = Math.atan2(dy, dx);
      } else if (isDragging.type === "leaf-tip1") {
        const i = isDragging.idx;
        const dx = mx - leafX[i];
        const dy = my - leafY[i];
        const dist = Math.hypot(dx, dy);
        leafLength[i] = Math.max(MIN_LEAF_LEN, Math.min(MAX_LEAF_LEN, dist * 2));
        leafAngle[i] = Math.atan2(dy, dx) + Math.PI;
      } else if (isDragging.type === "leaf-pos") {
        const i = isDragging.idx;
        leafX[i] = Math.max(60, Math.min(740, mx));
        leafY[i] = Math.max(120, Math.min(480, my));
      } else if (isDragging.type === "cannon-pos") {
        if (Math.hypot(mx - isDragging.startMx, my - isDragging.startMy) > 3) {
          isDragging.moved = true;
        }
        cannonX = Math.max(CAN_MIN_X, Math.min(CAN_MAX_X, mx + isDragging.offsetX));
        cannonY = Math.max(CAN_MIN_Y, Math.min(CAN_MAX_Y, my + isDragging.offsetY));
      } else if (isDragging.type === "cannon-angle") {
        if (Math.hypot(mx - isDragging.startMx, my - isDragging.startMy) > 3) {
          isDragging.moved = true;
        }
        cannonAngle = Math.atan2(my - cannonY, mx - cannonX);
      }
      renderPondCanvas();
    } else {
      // Hover detection & dynamic cursor
      hoveredLeaf = -1;
      let cursor = "crosshair";

      const distBase = Math.hypot(mx - cannonX, my - cannonY);
      const barrelTipX = cannonX + Math.cos(cannonAngle) * 24;
      const barrelTipY = cannonY + Math.sin(cannonAngle) * 24;
      const distTip = Math.hypot(mx - barrelTipX, my - barrelTipY);

      if (distTip < 16) {
        cursor = "crosshair";
      } else if (distBase < 28 || (Math.abs(mx - cannonX) < 26 && Math.abs(my - cannonY) < 32)) {
        cursor = "move";
      } else {
        for (let i = 0; i < num; i++) {
          const lx = leafX[i];
          const ly = leafY[i];
          const len = leafLength[i];
          const ang = leafAngle[i];
          const halfL = len * 0.5;
          const p2x = lx + Math.cos(ang) * halfL;
          const p2y = ly + Math.sin(ang) * halfL;
          const p1x = lx - Math.cos(ang) * halfL;
          const p1y = ly - Math.sin(ang) * halfL;

          if (Math.hypot(mx - p2x, my - p2y) < 20 || Math.hypot(mx - p1x, my - p1y) < 20) {
            hoveredLeaf = i;
            cursor = "ew-resize";
            break;
          } else if (Math.hypot(mx - lx, my - ly) < 24) {
            hoveredLeaf = i;
            cursor = "move";
            break;
          } else if (Math.hypot(mx - lx, my - ly) < len * 0.55) {
            hoveredLeaf = i;
          }
        }
      }
      pondCanvas.style.cursor = cursor;
      renderPondCanvas();
    }
  });

  const stopDrag = (e) => {
    if (isDragging) {
      if ((isDragging.type === "cannon-pos" || isDragging.type === "cannon-angle") && !isDragging.moved) {
        firePlankton(); // Tap to fire immediately!
      }
      try { pondCanvas.releasePointerCapture(e.pointerId); } catch (_) {}
      isDragging = null;
      forceRegenRhythm = true;
      doGenerate(true);
      forceRegenRhythm = false;
      syncRhythmGrid();
    }
  };

  pondCanvas.addEventListener("pointerup", stopDrag);
  pondCanvas.addEventListener("pointercancel", stopDrag);

  canvasCard.append(canvasHeader, pondCanvas);
  display.appendChild(canvasCard);

  layout.append(module, display);
  hanenbowContainer.appendChild(layout);

  initHanenbowSystem(state.hanenbowPreset || "cascade");
  syncControlsFromState();
}

// ---- Model Activation Lifecycle ----
export function activateHanenbowModel() {
  setModelGenerator(generateHanenbowBank);
  setModelRandomizer(randomizeHanenbow);
  setModelStepHandler(null);
  setModelTransportHandler({
    toggle: toggleHanenbowRunning,
    stop: stopHanenbow,
    start: startHanenbow,
    isRunning: isHanenbowRunning
  });

  doGenerate(false);
  renderPondCanvas();

  if (!animFrameId && typeof requestAnimationFrame === "function") {
    lastFrameTime = performance.now();
    animFrameId = requestAnimationFrame(freeLoop);
  }

  status("Hanenbow Ballistics: Ready (Press Play or Spacebar to start)", "ok");
}

export function deactivateHanenbowModel() {
  stopHanenbow();
  setModelStepHandler(null);
  setModelTransportHandler(null);
  setModelGenerator(null);
  setModelRandomizer(null);

  releasePolyVoices();
  voiceSlots.fill(null);
  lastLiveStep = -1;

  if (animFrameId && typeof cancelAnimationFrame === "function") {
    cancelAnimationFrame(animFrameId);
    animFrameId = null;
  }
}

// ---- Session Snapshot Integration ----
registerModel({
  id: "hanenbow",
  version: 1,
  migrations: {},
  capture() {
    const leavesArr = [];
    const num = Math.min(MAX_LEAVES, Math.max(2, state.hanenbowLeaves ?? 5));
    for (let i = 0; i < num; i++) {
      leavesArr.push({
        x: leafX[i],
        y: leafY[i],
        len: leafLength[i],
        angle: leafAngle[i],
        pitch: leafPitchIdx[i]
      });
    }

    return {
      leaves: state.hanenbowLeaves,
      gravity: state.hanenbowGravity,
      elasticity: state.hanenbowElasticity,
      fireRate: state.hanenbowFireRate,
      speed: state.hanenbowLaunchSpeed,
      preset: state.hanenbowPreset,
      mode: state.hanenbowMode,
      span: state.hanenbowSpan,
      gateLen: state.hanenbowGateLen,
      timingPeriod: state.hanenbowTimingPeriod,
      cannon: { x: cannonX, y: cannonY, angle: cannonAngle, speed: cannonSpeed },
      leafData: leavesArr
    };
  },
  restore(h) {
    if (h?.leaves !== undefined) state.hanenbowLeaves = h.leaves;
    if (h?.gravity !== undefined) state.hanenbowGravity = h.gravity;
    if (h?.elasticity !== undefined) state.hanenbowElasticity = h.elasticity;
    if (h?.fireRate !== undefined) state.hanenbowFireRate = h.fireRate;
    if (h?.speed !== undefined) state.hanenbowLaunchSpeed = h.speed;
    if (h?.preset !== undefined) state.hanenbowPreset = h.preset;
    if (h?.mode !== undefined) state.hanenbowMode = h.mode;
    if (h?.span !== undefined) state.hanenbowSpan = h.span;
    if (h?.gateLen !== undefined) state.hanenbowGateLen = h.gateLen;
    if (h?.timingPeriod !== undefined) state.hanenbowTimingPeriod = h.timingPeriod;

    if (Array.isArray(h?.leafData)) {
      for (let i = 0; i < Math.min(MAX_LEAVES, h.leafData.length); i++) {
        const ld = h.leafData[i];
        if (ld.x !== undefined) leafX[i] = ld.x;
        if (ld.y !== undefined) leafY[i] = ld.y;
        if (ld.len !== undefined) leafLength[i] = Math.max(MIN_LEAF_LEN, Math.min(MAX_LEAF_LEN, ld.len));
        if (ld.angle !== undefined) leafAngle[i] = ld.angle;
        if (ld.pitch !== undefined) leafPitchIdx[i] = ld.pitch;
      }
    } else {
      initHanenbowSystem(state.hanenbowPreset || "cascade");
    }

    if (h?.cannon) {
      cannonX = Math.max(CAN_MIN_X, Math.min(CAN_MAX_X, h.cannon.x ?? cannonX));
      cannonY = Math.max(CAN_MIN_Y, Math.min(CAN_MAX_Y, h.cannon.y ?? cannonY));
      cannonAngle = h.cannon.angle ?? cannonAngle;
      cannonSpeed = h.cannon.speed ?? cannonSpeed;
    }

    syncControlsFromState();
    renderPondCanvas();
  }
});
