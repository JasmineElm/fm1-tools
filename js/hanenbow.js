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
  setModelGenerator, setModelRandomizer
} from "./state.js";
import { knob, dropdown, actionBtn } from "./controls.js";
import { isLive, setModelStepHandler } from "./player.js?v=1";
import { liveNoteOn, liveNoteOff, panicPreview } from "./player.js";
import { SCALE_LABELS, ROOT_NOTE_OPTIONS, ROOT_OCTAVE_OPTIONS, mapNormalizedToNote, getRootMidi, getActiveScaleIntervals, computeOctaveShift, createNotesSection } from "./scale.js?v=1";
import { syncRhythmGrid } from "./rhythm.js";
import { getActiveModel } from "./modes.js";
import { quantize, midiName, SCALES } from "./generator.js";
import { registerModel } from "./snapshot.js";
import * as midi from "./midi.js";
import * as audio from "./audio.js";

// ---- Constants & Pre-allocated TypedArray Buffers (Zero GC Churn) ----
const MAX_LEAVES = 8;
const MAX_PLANKTON = 16;
const MAX_VOICES = 8;
const activeVoices = new Map(); // note -> timeoutId
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

// Leaf Stem & Surface Buffers
const leafX = new Float32Array(MAX_LEAVES);
const leafY = new Float32Array(MAX_LEAVES);
const leafLength = new Float32Array(MAX_LEAVES);
const leafAngle = new Float32Array(MAX_LEAVES);
const leafBend = new Float32Array(MAX_LEAVES);
const leafBendVel = new Float32Array(MAX_LEAVES);
const leafBloom = new Float32Array(MAX_LEAVES); // 0.0 (green) -> 1.0 (bloomed amber/pink)
const leafPitchIdx = new Int32Array(MAX_LEAVES);

// Cannon Launcher State
let cannonX = 80;
let cannonY = 480;
let cannonAngle = -Math.PI / 3; // -60 degrees
let cannonSpeed = 650;
let cannonPulse = 0;
let fireTimer = 0;

let lastLiveStep = -1;
let animFrameId = null;
let lastFrameTime = 0;

// Dragging & Interaction State
let isDragging = null; // null | { type: "leaf-angle"|"leaf-pos"|"cannon-angle"|"cannon-pos", idx: number }
let hoveredLeaf = -1;

// UI DOM references
let hanenbowContainer = null;
let pondCanvas = null;
let modeToggleBtn = null;
let presetSelect = null;
let notesSection = null;

// Presets for classic pond layouts
export const HANENBOW_PRESETS = [
  {
    id: "cascade",
    name: "Waterfall Cascade",
    desc: "Staggered diagonal leaves funneling ricochets in descending/ascending arpeggio cascades",
    leaves: 5,
    cannon: { x: 75, y: 460, angle: -0.95, speed: 640 },
    leafData: [
      { x: 190, y: 340, len: 110, angle: -0.22, pitch: 0 },
      { x: 340, y: 260, len: 105, angle: 0.35,  pitch: 2 },
      { x: 500, y: 220, len: 100, angle: -0.40, pitch: 4 },
      { x: 640, y: 310, len: 110, angle: -0.65, pitch: 5 },
      { x: 470, y: 420, len: 120, angle: 0.25,  pitch: 7 }
    ],
    gravity: 950,
    elasticity: 0.88,
    fireRate: 1.6
  },
  {
    id: "fountain",
    name: "Acoustic Fountain",
    desc: "Symmetrical V-shaped bounce leaves returning plankton in tall parabolic ricochet arcs",
    leaves: 6,
    cannon: { x: 380, y: 500, angle: -Math.PI / 2, speed: 720 },
    leafData: [
      { x: 260, y: 240, len: 115, angle: 0.55,  pitch: 4 },
      { x: 500, y: 240, len: 115, angle: -0.55, pitch: 4 },
      { x: 160, y: 360, len: 110, angle: 0.35,  pitch: 1 },
      { x: 600, y: 360, len: 110, angle: -0.35, pitch: 1 },
      { x: 310, y: 430, len: 100, angle: -0.15, pitch: 6 },
      { x: 450, y: 430, len: 100, angle: 0.15,  pitch: 6 }
    ],
    gravity: 980,
    elasticity: 0.85,
    fireRate: 1.4
  },
  {
    id: "pinball",
    name: "Pachinko Pinball",
    desc: "Alternating criss-cross leaves yielding syncopated polyrhythmic ricochets and double strikes",
    leaves: 7,
    cannon: { x: 90, y: 480, angle: -1.1, speed: 700 },
    leafData: [
      { x: 210, y: 250, len: 110, angle: 0.40,  pitch: 0 },
      { x: 380, y: 200, len: 100, angle: -0.45, pitch: 2 },
      { x: 550, y: 260, len: 105, angle: 0.38,  pitch: 4 },
      { x: 680, y: 370, len: 100, angle: -0.60, pitch: 6 },
      { x: 510, y: 380, len: 110, angle: -0.30, pitch: 3 },
      { x: 340, y: 390, len: 100, angle: 0.25,  pitch: 1 },
      { x: 200, y: 440, len: 110, angle: -0.15, pitch: 5 }
    ],
    gravity: 1020,
    elasticity: 0.90,
    fireRate: 1.8
  },
  {
    id: "belltree",
    name: "Resonant Bell Tree",
    desc: "Ascending ladder of leaves with tight micro-timing intervals and ascending melodic runs",
    leaves: 6,
    cannon: { x: 120, y: 500, angle: -0.85, speed: 680 },
    leafData: [
      { x: 230, y: 420, len: 120, angle: 0.20,  pitch: 0 },
      { x: 360, y: 340, len: 110, angle: -0.25, pitch: 1 },
      { x: 480, y: 270, len: 105, angle: 0.28,  pitch: 2 },
      { x: 600, y: 210, len: 100, angle: -0.32, pitch: 3 },
      { x: 420, y: 160, len: 95,  angle: 0.35,  pitch: 5 },
      { x: 280, y: 220, len: 100, angle: -0.28, pitch: 7 }
    ],
    gravity: 920,
    elasticity: 0.86,
    fireRate: 1.5
  },
  {
    id: "zen",
    name: "Zen Garden Chimes",
    desc: "Spacious, gentle shallow leaves for slow ambient ring-outs and peaceful water drop bounces",
    leaves: 4,
    cannon: { x: 100, y: 450, angle: -0.80, speed: 600 },
    leafData: [
      { x: 260, y: 360, len: 135, angle: 0.15,  pitch: 0 },
      { x: 450, y: 300, len: 130, angle: -0.18, pitch: 2 },
      { x: 620, y: 380, len: 125, angle: -0.25, pitch: 4 },
      { x: 380, y: 440, len: 130, angle: 0.12,  pitch: 7 }
    ],
    gravity: 800,
    elasticity: 0.82,
    fireRate: 1.0
  }
];

// ---- Pond & Ballistics Initialization ----
export function initHanenbowSystem(presetId = state.hanenbowPreset || "cascade") {
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
  }

  // Clear plankton projectile pool
  for (let i = 0; i < MAX_PLANKTON; i++) {
    pActive[i] = 0;
    pX[i] = 0;
    pY[i] = 0;
    pVx[i] = 0;
    pVy[i] = 0;
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

// ---- Audio Dispatch & Voice Slot Management (Strict 8-Voice Ceiling) ----
function playLeafVoice(leafIdx, note, vel, durMs) {
  // Voice stealing within dedicated leaf voice slot
  const prevNote = voiceSlots[leafIdx];
  if (prevNote !== null) {
    liveNoteOff(prevNote);
    audio.noteOff(prevNote);
    activeVoices.delete(prevNote);
    voiceSlots[leafIdx] = null;
  }

  // Global 8-voice limit enforcement
  if (activeVoices.size >= MAX_VOICES) {
    const oldest = activeVoices.keys().next().value;
    if (oldest !== undefined) {
      clearTimeout(activeVoices.get(oldest));
      liveNoteOff(oldest);
      audio.noteOff(oldest);
      activeVoices.delete(oldest);
    }
  }

  audio.unlock();
  liveNoteOn(note, vel);
  audio.noteOn(note, vel);
  voiceSlots[leafIdx] = note;

  const tid = setTimeout(() => {
    activeVoices.delete(note);
    if (voiceSlots[leafIdx] === note) voiceSlots[leafIdx] = null;
    liveNoteOff(note);
    audio.noteOff(note);
  }, durMs);
  activeVoices.set(note, tid);

  // Modulate FM-1 CC #74 Brightness with impact force
  const ccDest = state.hanenbowCcDest ?? 74;
  const ccDepth = state.hanenbowCcDepth ?? 85;
  if (ccDepth > 0) {
    const normVel = Math.min(1.0, Math.max(0.1, vel / 127.0));
    const ccVal = Math.min(127, Math.max(20, Math.round(normVel * ccDepth + (127 - ccDepth) * 0.25)));
    try {
      midi.sendControlChange(ccDest, ccVal);
    } catch (_) {}
  }
}

// Resolves a scale-quantized pitch for leaf `i`
export function getLeafNote(i) {
  const intervals = getActiveScaleIntervals();
  const root = getRootMidi();
  const span = state.hanenbowSpan ?? 3;
  const num = Math.min(MAX_LEAVES, Math.max(2, state.hanenbowLeaves ?? 5));

  // Map leaf position in pond: higher Y (closer to water top) = higher octave
  const normHeight = 1.0 - Math.min(1.0, Math.max(0.0, (leafY[i] - 140) / 360));
  const octave = Math.floor(normHeight * (span - 1));
  const deg = (leafPitchIdx[i] ?? i) % intervals.length;

  return quantize(root + octave * 12 + (intervals[deg] || 0));
}

// ---- Ballistics & Physics Step ----
function stepBallistics(dt) {
  const num = Math.min(MAX_LEAVES, Math.max(2, state.hanenbowLeaves ?? 5));
  const grav = state.hanenbowGravity ?? 980;
  const rest = state.hanenbowElasticity ?? 0.85;

  // 1. Advance plankton projectiles
  for (let p = 0; p < MAX_PLANKTON; p++) {
    if (pActive[p] === 0) continue;

    // Shift tail trail
    for (let t = TRAIL_PTS - 1; t > 0; t--) {
      pTrailX[p * TRAIL_PTS + t] = pTrailX[p * TRAIL_PTS + t - 1];
      pTrailY[p * TRAIL_PTS + t] = pTrailY[p * TRAIL_PTS + t - 1];
    }
    pTrailX[p * TRAIL_PTS] = pX[p];
    pTrailY[p * TRAIL_PTS] = pY[p];

    pVy[p] += grav * dt;
    pX[p] += pVx[p] * dt;
    pY[p] += pVy[p] * dt;

    // Check bounds: fall below pond water level (Y > 580) or off-screen
    if (pX[p] < -30 || pX[p] > 860 || pY[p] > 580) {
      pActive[p] = 0;
      continue;
    }

    // 2. Collision with leaves (Circle-to-Line Segment projection)
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

      if (dist < pRadius + 6.0) {
        // Normal to leaf segment
        const nx = -sinA;
        const ny = cosA;
        const dot = pVx[p] * nx + pVy[p] * ny;

        if (dot < 0) {
          // Specular rebound with restitution
          pVx[p] -= (1 + rest) * dot * nx;
          pVy[p] -= (1 + rest) * dot * ny;

          // Push plankton slightly off surface to prevent collision sticking
          pX[p] = closeX + nx * (pRadius + 7.0);
          pY[p] = closeY + ny * (pRadius + 7.0);

          // Leaf spring elastic impulse & bloom
          leafBendVel[j] += dot * 0.0008;
          leafBloom[j] = Math.min(1.0, leafBloom[j] + 0.35);

          // Trigger leaf sound
          const note = getLeafNote(j);
          const vel = Math.min(127, Math.max(40, Math.round(Math.abs(dot) * 0.22)));
          const gateLen = state.hanenbowGateLen ?? 240;
          playLeafVoice(j, note, vel, gateLen);
        }
      }
    }
  }

  // 3. Update leaf spring damped oscillations
  const omega0 = 24.0; // natural spring frequency
  const zeta = 0.22;   // damping ratio
  for (let j = 0; j < num; j++) {
    const accel = -omega0 * omega0 * leafBend[j] - 2 * zeta * omega0 * leafBendVel[j];
    leafBendVel[j] += accel * dt;
    leafBend[j] += leafBendVel[j] * dt;
    leafBloom[j] = Math.max(0.0, leafBloom[j] - dt * 0.4); // bloom decay
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

  if (state.hanenbowMode === "free") {
    // Cannon fire clock in free mode
    const fireInterval = 1.0 / Math.max(0.2, state.hanenbowFireRate ?? 1.5);
    fireTimer += dt;
    if (fireTimer >= fireInterval) {
      fireTimer = 0;
      firePlankton();
    }
  }

  // Always step ballistics so launched projectiles continue flying and ricocheting smoothly
  stepBallistics(dt);

  renderPondCanvas();
  animFrameId = requestAnimationFrame(freeLoop);
}

// ---- Transport Step Handler (Sync Mode) ----
export function onHanenbowLiveStep(step) {
  if (state.hanenbowMode !== "sync") return;
  if (step === lastLiveStep) return;
  lastLiveStep = step;

  // Fire cannon on transport step divisions (e.g. every 4th step or based on fireRate)
  const fireDiv = Math.max(2, Math.round(8 / (state.hanenbowFireRate ?? 1.5)));
  if (step % fireDiv === 0) {
    firePlankton();
  }

  const curBank = getBank();
  const seq = curBank?.[getSelected()] || curBank?.[0];
  if (!seq || !seq.steps) return;

  const st = seq.steps[step];
  if (!st || !st.notes || st.notes.length === 0) return;

  // Step triggers in sync mode obey Rhythm grid mutes
  for (const n of st.notes) {
    if (n && n.note !== undefined) {
      const leafIdx = step % Math.max(1, state.hanenbowLeaves ?? 5);
      playLeafVoice(leafIdx, n.note, n.vel || 90, state.hanenbowGateLen ?? 240);
      leafBloom[leafIdx] = 1.0;
    }
  }
}

// ---- Bank Generator Contract (`return bank`) ----
export function generateHanenbowBank(st) {
  const seqLen = Math.max(1, Math.min(64, st.length || 16));
  const bank = [];
  const intervals = getActiveScaleIntervals();
  const root = getRootMidi();
  const num = Math.min(MAX_LEAVES, Math.max(2, st.hanenbowLeaves ?? 5));
  const span = st.hanenbowSpan ?? 3;

  for (let s = 0; s < 16; s++) {
    const pattern = {
      length: seqLen,
      rate: st.rate ?? 6,
      steps: []
    };

    // Forward deterministic projectile simulation across the sequence steps
    const simDt = 0.02;
    const simGrav = st.hanenbowGravity ?? 980;
    const simRest = st.hanenbowElasticity ?? 0.85;

    let simPx = cannonX + Math.cos(cannonAngle) * 22;
    let simPy = cannonY + Math.sin(cannonAngle) * 22;
    const spd = (st.hanenbowLaunchSpeed ?? 650) * (0.95 + s * 0.01);
    let simVx = Math.cos(cannonAngle) * spd;
    let simVy = Math.sin(cannonAngle) * spd;

    for (let step = 0; step < seqLen; step++) {
      const stepNotes = [];

      // Advance physics by sub-steps per sequence step
      for (let sub = 0; sub < 4; sub++) {
        simVy += simGrav * simDt;
        simPx += simVx * simDt;
        simPy += simVy * simDt;

        if (simPy > 580 || simPx < -30 || simPx > 860) {
          // Respawn at cannon for continuous cycle
          simPx = cannonX + Math.cos(cannonAngle) * 22;
          simPy = cannonY + Math.sin(cannonAngle) * 22;
          simVx = Math.cos(cannonAngle) * spd;
          simVy = Math.sin(cannonAngle) * spd;
        }

        // Check leaf collisions
        for (let j = 0; j < num; j++) {
          const lx = leafX[j];
          const ly = leafY[j];
          const len = leafLength[j];
          const ang = leafAngle[j];

          const cosA = Math.cos(ang);
          const sinA = Math.sin(ang);
          const halfL = len * 0.5;

          const segP1x = lx - cosA * halfL;
          const segP1y = ly - sinA * halfL;
          const segDx = cosA * len;
          const segDy = sinA * len;
          const segLenSq = len * len;

          const u = Math.max(0, Math.min(1, ((simPx - segP1x) * segDx + (simPy - segP1y) * segDy) / segLenSq));
          const closeX = segP1x + u * segDx;
          const closeY = segP1y + u * segDy;
          const dist = Math.hypot(simPx - closeX, simPy - closeY);

          if (dist < pRadius + 6.0) {
            const nx = -sinA, ny = cosA;
            const dot = simVx * nx + simVy * ny;

            if (dot < 0) {
              simVx -= (1 + simRest) * dot * nx;
              simVy -= (1 + simRest) * dot * ny;

              const normHeight = 1.0 - Math.min(1.0, Math.max(0.0, (ly - 140) / 360));
              const oct = Math.floor(normHeight * (span - 1));
              const deg = (leafPitchIdx[j] + s) % intervals.length;
              const note = quantize(root + oct * 12 + (intervals[deg] || 0));
              const vel = Math.min(127, Math.max(45, Math.round(Math.abs(dot) * 0.22)));

              if (!stepNotes.some(sn => sn.note === note) && stepNotes.length < 3) {
                stepNotes.push({ note, vel });
              }
            }
          }
        }
      }

      // If no collision occurred on this step, provide sparse acoustic chimes
      if (stepNotes.length === 0 && (step % (Math.max(2, Math.floor(seqLen / num))) === 0)) {
        const leafIdx = (step / 2) % num;
        const normHeight = 1.0 - Math.min(1.0, Math.max(0.0, (leafY[leafIdx] - 140) / 360));
        const oct = Math.floor(normHeight * (span - 1));
        const deg = (leafPitchIdx[leafIdx] + s) % intervals.length;
        const note = quantize(root + oct * 12 + (intervals[deg] || 0));
        stepNotes.push({ note, vel: 65 });
      }

      pattern.steps.push({
        notes: stepNotes,
        gate: stepNotes.length > 0
      });
    }

    bank.push(pattern);
  }

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

  // 2. Draw leaves, stems, and rotation handles
  for (let i = 0; i < num; i++) {
    const lx = leafX[i] * scaleX;
    const ly = leafY[i] * scaleY;
    const len = leafLength[i] * scaleX;
    const ang = leafAngle[i] + leafBend[i];
    const halfL = len * 0.5;

    // Stem: organic line anchored at the pond bottom
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = colLine;
    ctx.beginPath();
    ctx.moveTo(lx, waterY);
    ctx.quadraticCurveTo(lx + (i % 2 === 0 ? 20 : -20) * scaleX, (ly + waterY) * 0.5, lx, ly);
    ctx.stroke();

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

    // Draw leaf body (flat rounded leaf segment)
    ctx.lineWidth = 8 * scaleY;
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

    // Leaf center pivot node
    ctx.fillStyle = isSelected ? "#ffffff" : colBg;
    ctx.beginPath();
    ctx.arc(lx, ly, 4 * scaleX, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = colLineFocus;
    ctx.stroke();

    // Rotation handle at outer tip (p2)
    ctx.fillStyle = isSelected ? colAccent : colPanel2;
    ctx.beginPath();
    ctx.arc(p2x, p2y, 5 * scaleX, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = isSelected ? "#ffffff" : colLineFocus;
    ctx.stroke();

    // Leaf pitch & index label
    ctx.fillStyle = colFg;
    ctx.font = `bold ${Math.round(9 * scaleX)}px monospace`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(`L${i + 1}`, lx, ly - 14 * scaleY);
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

  // Cannon aiming trajectory guide arc (subtle dashed line)
  ctx.save();
  ctx.strokeStyle = "rgba(0, 240, 255, 0.35)";
  ctx.lineWidth = 1.5;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  let arcX = cannonX;
  let arcY = cannonY;
  const spd = state.hanenbowLaunchSpeed ?? cannonSpeed;
  let arcVx = Math.cos(cannonAngle) * spd;
  let arcVy = Math.sin(cannonAngle) * spd;
  const grav = state.hanenbowGravity ?? 980;
  const stepT = 0.025;
  ctx.moveTo(arcX * scaleX, arcY * scaleY);
  for (let s = 0; s < 26; s++) {
    arcVy += grav * stepT;
    arcX += arcVx * stepT;
    arcY += arcVy * stepT;
    if (arcY > 520 || arcX < 0 || arcX > 800) break;
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
  if (refs.hanenbowCcDepth?.setValue) refs.hanenbowCcDepth.setValue(state.hanenbowCcDepth, false);
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

  // Card 1: Header, Mode Toggle, and Actions
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

  modeToggleBtn = document.createElement("button");
  modeToggleBtn.className = "btn-action";
  modeToggleBtn.style.fontSize = "10px";
  modeToggleBtn.style.padding = "3px 8px";
  modeToggleBtn.textContent = state.hanenbowMode === "free" ? "Free Loop" : "Sync Step";
  modeToggleBtn.title = "Toggle between transport step sync and free-running continuous ballistics";
  modeToggleBtn.addEventListener("click", () => {
    state.hanenbowMode = state.hanenbowMode === "free" ? "sync" : "free";
    modeToggleBtn.textContent = state.hanenbowMode === "free" ? "Free Loop" : "Sync Step";
    renderPondCanvas();
    status(`Hanenbow mode: ${state.hanenbowMode.toUpperCase()}`, "ok");
  });

  const btnFire = document.createElement("button");
  btnFire.className = "btn-action";
  btnFire.style.fontSize = "10px";
  btnFire.style.padding = "3px 8px";
  btnFire.textContent = "Launch";
  btnFire.title = "Launch a plankton creature from the cannon";
  btnFire.addEventListener("click", () => {
    firePlankton();
  });

  const btnRnd = document.createElement("button");
  btnRnd.className = "btn-action primary";
  btnRnd.style.fontSize = "10px";
  btnRnd.style.padding = "3px 8px";
  btnRnd.textContent = "Randomise";
  btnRnd.title = "Generate a new pond leaf layout (or press R/G)";
  btnRnd.addEventListener("click", () => {
    randomizeHanenbow();
  });

  actionsGroup.append(modeToggleBtn, btnFire, btnRnd);
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
      initHanenbowSystem(pid);
      syncControlsFromState();
      forceRegenRhythm = true;
      doGenerate(true);
      forceRegenRhythm = false;
      syncRhythmGrid();
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
      initHanenbowSystem(state.hanenbowPreset);
      forceRegenRhythm = true;
      doGenerate(true);
      forceRegenRhythm = false;
      syncRhythmGrid();
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
      forceRegenRhythm = true;
      doGenerate(true);
      forceRegenRhythm = false;
    }
  });
  R("hanenbowGravity", kGrav);

  const kElast = knob({
    label: "BOUNCE",
    min: 0.50, max: 0.98, step: 0.02,
    value: state.hanenbowElasticity ?? 0.85,
    unit: "e",
    title: "Specular restitution coefficient of leaves",
    onChange: (v) => {
      state.hanenbowElasticity = v;
      forceRegenRhythm = true;
      doGenerate(true);
      forceRegenRhythm = false;
    }
  });
  R("hanenbowElasticity", kElast);

  const kRate = knob({
    label: "LAUNCH",
    min: 0.4, max: 4.0, step: 0.1,
    value: state.hanenbowFireRate ?? 1.5,
    unit: "Hz",
    title: "Plankton fire rate",
    onChange: (v) => {
      state.hanenbowFireRate = v;
      forceRegenRhythm = true;
      doGenerate(true);
      forceRegenRhythm = false;
    }
  });
  R("hanenbowFireRate", kRate);

  const kSpd = knob({
    label: "SPEED",
    min: 300, max: 950, step: 25,
    value: state.hanenbowLaunchSpeed ?? 650,
    unit: "",
    title: "Cannon launch velocity magnitude",
    onChange: (v) => {
      state.hanenbowLaunchSpeed = v;
      forceRegenRhythm = true;
      doGenerate(true);
      forceRegenRhythm = false;
    }
  });
  R("hanenbowLaunchSpeed", kSpd);

  const kCc = knob({
    label: "FM CC74",
    min: 0, max: 127, step: 1,
    value: state.hanenbowCcDepth ?? 85,
    unit: "",
    title: "FM-1 CC #74 Brightness modulation depth driven by impact kinetic force",
    onChange: (v) => { state.hanenbowCcDepth = v; }
  });
  R("hanenbowCcDepth", kCc);

  paramGrid.append(kLeaves, kGrav, kElast, kRate, kSpd, kCc);
  paramCard.appendChild(paramGrid);

  // Card 3: Notes & Scale Controls
  notesSection = createNotesSection("hanenbow", () => {
    forceRegenRhythm = true;
    doGenerate(true);
    forceRegenRhythm = false;
    syncRhythmGrid();
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
    <span style="font-size:9px; color:var(--dim);">Drag leaf tips to rotate · Drag stems to move</span>
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

    // Check click on cannon
    if (Math.hypot(mx - cannonX, my - cannonY) < 28) {
      isDragging = { type: "cannon-angle", idx: 0 };
      pondCanvas.setPointerCapture(e.pointerId);
      return;
    }

    // Check hit test on leaf rotation tip handle or leaf center
    for (let i = 0; i < num; i++) {
      const lx = leafX[i];
      const ly = leafY[i];
      const len = leafLength[i];
      const ang = leafAngle[i];
      const tipX = lx + Math.cos(ang) * len * 0.5;
      const tipY = ly + Math.sin(ang) * len * 0.5;

      // Handle tip rotation
      if (Math.hypot(mx - tipX, my - tipY) < 20) {
        isDragging = { type: "leaf-angle", idx: i };
        pondCanvas.setPointerCapture(e.pointerId);
        return;
      }

      // Handle leaf center translation
      if (Math.hypot(mx - lx, my - ly) < 22) {
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
      if (isDragging.type === "leaf-angle") {
        const i = isDragging.idx;
        leafAngle[i] = Math.atan2(my - leafY[i], mx - leafX[i]);
      } else if (isDragging.type === "leaf-pos") {
        const i = isDragging.idx;
        leafX[i] = Math.max(60, Math.min(740, mx));
        leafY[i] = Math.max(120, Math.min(480, my));
      } else if (isDragging.type === "cannon-angle") {
        cannonAngle = Math.atan2(my - cannonY, mx - cannonX);
      }
      renderPondCanvas();
    } else {
      // Hover detection
      hoveredLeaf = -1;
      for (let i = 0; i < num; i++) {
        if (Math.hypot(mx - leafX[i], my - leafY[i]) < 30) {
          hoveredLeaf = i;
          break;
        }
      }
      renderPondCanvas();
    }
  });

  const stopDrag = (e) => {
    if (isDragging) {
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
  setModelStepHandler(onHanenbowLiveStep);

  const curBank = getBank();
  const hasExistingSteps = curBank?.[0]?.steps?.some((st) => (st.notes && st.notes.length > 0) || st._savedNote);
  if (!hasExistingSteps) {
    forceRegenRhythm = true;
  }
  doGenerate(true);
  forceRegenRhythm = false;

  syncRhythmGrid();
  renderPondCanvas();

  if (!animFrameId) {
    lastFrameTime = performance.now();
    animFrameId = requestAnimationFrame(freeLoop);
  }

  // Auto-launch a projectile on entering so the pond is immediately active and visible
  firePlankton();
}

export function deactivateHanenbowModel() {
  panicPreview();
  audio.allOff();
  setModelStepHandler(null);
  activeVoices.clear();
  voiceSlots.fill(null);
  lastLiveStep = -1;

  if (animFrameId) {
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
      ccDepth: state.hanenbowCcDepth,
      gateLen: state.hanenbowGateLen,
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
    if (h?.ccDepth !== undefined) state.hanenbowCcDepth = h.ccDepth;
    if (h?.gateLen !== undefined) state.hanenbowGateLen = h.gateLen;

    if (h?.cannon) {
      cannonX = h.cannon.x ?? cannonX;
      cannonY = h.cannon.y ?? cannonY;
      cannonAngle = h.cannon.angle ?? cannonAngle;
      cannonSpeed = h.cannon.speed ?? cannonSpeed;
    }

    if (Array.isArray(h?.leafData)) {
      for (let i = 0; i < Math.min(MAX_LEAVES, h.leafData.length); i++) {
        const ld = h.leafData[i];
        if (ld.x !== undefined) leafX[i] = ld.x;
        if (ld.y !== undefined) leafY[i] = ld.y;
        if (ld.len !== undefined) leafLength[i] = ld.len;
        if (ld.angle !== undefined) leafAngle[i] = ld.angle;
        if (ld.pitch !== undefined) leafPitchIdx[i] = ld.pitch;
      }
    } else {
      initHanenbowSystem(state.hanenbowPreset || "cascade");
    }

    syncControlsFromState();
    renderPondCanvas();
  }
});
