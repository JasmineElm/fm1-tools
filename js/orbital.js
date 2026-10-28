// orbital.js — Keplerian Orbital Resonance & N-Body Chimes for FM-1 Pulses.
// Multi-body celestial mechanics simulator driven by Symplectic Velocity-Verlet numerical integration.
//
// Generative Architecture:
// 1. Central gravitational star (GM) with up to 8 orbiting planetary bodies (strict 8-voice limit).
// 2. Symplectic Velocity-Verlet continuous numerical integration with TypedArray buffers (zero GC churn).
// 3. Periapsis velocity transits (closest approach) triggering melodic chimes and accelerandos.
// 4. Angular celestial conjunctions (mutual planetary radial alignments) triggering harmonic chords.
// 5. Strict 8-voice polyphony ceiling with dedicated per-body voice slots & FIFO note stealing.
// 6. Continuous FM-1 CC #74 Brightness modulation driven by total system kinetic energy.
// 7. Direct manipulation: interactive canvas to scrub orbital radii, phase anomalies, and eccentricity.
// 8. Dual Sync/Free modes: 64-step transport-locked grid sequence or continuous real-time celestial physics.

import {
  state, refs, R, setState, scheduleRegen, doGenerate,
  getBank, setBank, getSelected, setSelected, status, onRegen,
  setModelGenerator, setModelRandomizer
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
const MAX_BODIES = 8;
const MAX_VOICES = 8;
const voiceSlots = new Array(MAX_BODIES).fill(null); // active note per planet body

let forceRegenRhythm = false;

// Trail history ring buffer for smooth orbit trail rendering
const TRAIL_LEN = 64;
const trailX = new Float32Array(MAX_BODIES * TRAIL_LEN);
const trailY = new Float32Array(MAX_BODIES * TRAIL_LEN);
const trailHeads = new Int32Array(MAX_BODIES);
const trailCounts = new Int32Array(MAX_BODIES);

// Planetary simulation state buffers
const posX = new Float32Array(MAX_BODIES);
const posY = new Float32Array(MAX_BODIES);
const velX = new Float32Array(MAX_BODIES);
const velY = new Float32Array(MAX_BODIES);
const accX = new Float32Array(MAX_BODIES);
const accY = new Float32Array(MAX_BODIES);
const prevVr = new Float32Array(MAX_BODIES);
const semiMajor = new Float32Array(MAX_BODIES);
const eccentricity = new Float32Array(MAX_BODIES);
const bodyAngle = new Float32Array(MAX_BODIES);
const bodyMass = new Float32Array(MAX_BODIES);
const bodyColor = [
  "#00f0ff", // Planet 1: Cyan
  "#ff007f", // Planet 2: Pink
  "#ffb700", // Planet 3: Amber
  "#39ff14", // Planet 4: Lime
  "#a855f7", // Planet 5: Violet
  "#38bdf8", // Planet 6: Sky
  "#f43f5e", // Planet 7: Rose
  "#eab308"  // Planet 8: Gold
];

// Central star pulse indicator
let starPulse = 0;
let lastLiveStep = -1;
let currentLiveStep = -1;
let liveStepTime = 0;
let animFrameId = null;
let lastFrameTime = 0;
let isDraggingBody = -1; // -1 if not dragging, 0..7 if dragging a planet
let hoveredBody = -1;

// Trigger visual animation buffers (zero GC churn)
const triggerFlash = new Float32Array(MAX_BODIES);
const triggerRipple = new Float32Array(MAX_BODIES);
const triggerNoteName = new Array(MAX_BODIES).fill("");

let isOrbitalPlaying = false;

export function isOrbitalRunning() {
  return isOrbitalPlaying;
}

export function startOrbital() {
  if (isOrbitalPlaying) return;
  isOrbitalPlaying = true;
  audio.unlock();
  updatePlayBtnUI();
  status("Orbital: Playing · Keplerian celestial resonance chimes", "ok");
}

export function stopOrbital() {
  isOrbitalPlaying = false;
  panicPreview();
  try { audio.allOff(); } catch (_) {}
  activeVoices.clear();
  voiceSlots.fill(null);
  updatePlayBtnUI();
  status("stopped");
}

export function toggleOrbitalRunning() {
  if (isOrbitalPlaying) {
    stopOrbital();
    return false;
  } else {
    startOrbital();
    return true;
  }
}

function updatePlayBtnUI() {
  const headerBtn = document.getElementById("audition");
  if (headerBtn) {
    headerBtn.textContent = isOrbitalPlaying ? "■ Stop" : "▶ Play";
    if (isOrbitalPlaying) {
      headerBtn.classList.add("playing");
    } else {
      headerBtn.classList.remove("playing");
    }
  }
}

// UI DOM references
let orbitalContainer = null;
let orbitCanvas = null;
let presetSelect = null;
let bodiesCountDisplay = null;
let notesSection = null;

// Presets for classic celestial and resonance regimes
export const ORBITAL_PRESETS = [
  {
    id: "laplace",
    name: "Laplace Resonance (1:2:4)",
    desc: "Io-Europa-Ganymede locked 4:2:1 mean-motion resonance with periodic polyphonic downbeats",
    bodies: 4,
    radii: [75, 119, 189, 238],
    ecc: [0.05, 0.08, 0.12, 0.15],
    gravity: 1.0,
    speed: 1.0,
    triggerMode: "both"
  },
  {
    id: "solar",
    name: "Solar System (Titius-Bode)",
    desc: "Logarithmic geometric spacing: shimmering rapid inner orbits down to deep grounding outer baselines",
    bodies: 6,
    radii: [55, 80, 115, 160, 215, 275],
    ecc: [0.20, 0.06, 0.08, 0.15, 0.12, 0.18],
    gravity: 1.1,
    speed: 1.0,
    triggerMode: "periapsis"
  },
  {
    id: "fibonacci",
    name: "Golden Mean Orbits (φ)",
    desc: "Radii scaled by the Golden Ratio 1.618: avoids periodic phase lock for non-repeating polyrhythmic phrasing",
    bodies: 5,
    radii: [50, 81, 131, 212, 280],
    ecc: [0.15, 0.18, 0.22, 0.25, 0.28],
    gravity: 1.0,
    speed: 1.1,
    triggerMode: "both"
  },
  {
    id: "comet",
    name: "Comet Halley & The Eccentrics",
    desc: "Highly elongated ellipses: slow peaceful apapsis glides followed by explosive, high-velocity periapsis cascades",
    bodies: 4,
    radii: [85, 140, 200, 260],
    ecc: [0.65, 0.72, 0.76, 0.80],
    gravity: 1.2,
    speed: 0.9,
    triggerMode: "periapsis"
  },
  {
    id: "trojan",
    name: "Lagrangian Trojan Resonance",
    desc: "Co-orbital bodies sharing orbital radii with 60° phase offsets for constant sparkling counterpoint",
    bodies: 6,
    radii: [80, 80, 160, 160, 240, 240],
    ecc: [0.10, 0.10, 0.14, 0.14, 0.18, 0.18],
    gravity: 1.0,
    speed: 1.1,
    triggerMode: "both"
  },
  {
    id: "chaos_nbody",
    name: "Perturbed 3-Body Choreography",
    desc: "Dense inner planetary cluster with mutual orbital gravity enabled, creating organic phase precession",
    bodies: 4,
    radii: [70, 100, 140, 190],
    ecc: [0.30, 0.35, 0.40, 0.45],
    gravity: 1.2,
    speed: 1.2,
    triggerMode: "both"
  }
];

// ---- Celestial Mechanics Simulation & Setup ----
export function initPlanetarySystem(presetId = state.orbitalPreset || "laplace") {
  const p = ORBITAL_PRESETS.find(pr => pr.id === presetId) || ORBITAL_PRESETS[0];
  const num = Math.min(MAX_BODIES, Math.max(2, state.orbitalBodies ?? p.bodies));

  const baseEcc = state.orbitalEccentricity ?? 0.25;
  const grav = state.orbitalGravity ?? p.gravity;
  const GM = 400000 * grav;

  for (let i = 0; i < MAX_BODIES; i++) {
    trailHeads[i] = 0;
    trailCounts[i] = 0;
    bodyMass[i] = 1.0 + i * 0.5;

    if (i < num) {
      const a = p.radii[i] !== undefined ? p.radii[i] : 60 + i * 35;
      const e = Math.min(0.85, Math.max(0.0, p.ecc[i] !== undefined ? p.ecc[i] * (baseEcc / 0.25) : baseEcc));
      semiMajor[i] = a;
      eccentricity[i] = e;

      // Start at periapsis with Keplerian velocity
      const rPeri = Math.max(10, a * (1 - e));
      const vPeri = Math.sqrt((GM / a) * ((1 + e) / Math.max(0.01, 1 - e)));

      // Stagger initial orbital phases if co-orbital (like trojans)
      let initialAngle = 0;
      if (i > 0 && Math.abs(a - semiMajor[i - 1]) < 5) {
        initialAngle = (bodyAngle[i - 1] + Math.PI / 3) % (Math.PI * 2);
      } else {
        initialAngle = (i * (Math.PI * 2 / num) * 0.5) % (Math.PI * 2);
      }
      bodyAngle[i] = initialAngle;

      const cosA = Math.cos(initialAngle);
      const sinA = Math.sin(initialAngle);

      posX[i] = rPeri * cosA;
      posY[i] = rPeri * sinA;
      velX[i] = -vPeri * sinA;
      velY[i] = vPeri * cosA;

      prevVr[i] = 0;

      // Initial gravitational acceleration
      const r3 = Math.pow(rPeri, 3);
      accX[i] = -(GM * posX[i]) / r3;
      accY[i] = -(GM * posY[i]) / r3;
    } else {
      semiMajor[i] = 0;
      eccentricity[i] = 0;
      posX[i] = 0;
      posY[i] = 0;
      velX[i] = 0;
      velY[i] = 0;
      accX[i] = 0;
      accY[i] = 0;
    }
  }
}

function pushTrailPoint(i, x, y) {
  const head = trailHeads[i];
  const offset = i * TRAIL_LEN + head;
  trailX[offset] = x;
  trailY[offset] = y;
  trailHeads[i] = (head + 1) % TRAIL_LEN;
  if (trailCounts[i] < TRAIL_LEN) trailCounts[i]++;
}

// Symplectic Velocity-Verlet Integration Step
function stepVerlet(dt) {
  const num = Math.min(MAX_BODIES, Math.max(2, state.orbitalBodies ?? 5));
  const modelSpd = Math.max(0.1, Number(state.modelSpeed ?? state.orbitalSpeed ?? 1.0));
  const speed = modelSpd * 1.5;
  const h = dt * speed;
  const h2_half = 0.5 * h * h;
  const h_half = 0.5 * h;
  const grav = state.orbitalGravity ?? 1.0;
  const GM = 400000 * grav;
  const eps = 16.0; // Softening epsilon to prevent numerical division by zero

  // Step 1: Update positions using current velocities and accelerations
  for (let i = 0; i < num; i++) {
    posX[i] += velX[i] * h + accX[i] * h2_half;
    posY[i] += velY[i] * h + accY[i] * h2_half;
    pushTrailPoint(i, posX[i], posY[i]);
  }

  // Step 2: Compute new accelerations at new positions
  for (let i = 0; i < num; i++) {
    const x = posX[i];
    const y = posY[i];
    const rSq = x * x + y * y + eps;
    const r = Math.sqrt(rSq);
    const r3 = rSq * r;

    // Central star gravity
    let newAx = -(GM * x) / r3;
    let newAy = -(GM * y) / r3;

    // Optional mutual planetary gravity for chaotic regimes
    if (state.orbitalPreset === "chaos_nbody") {
      for (let j = 0; j < num; j++) {
        if (i === j) continue;
        const dx = posX[j] - x;
        const dy = posY[j] - y;
        const distSq = dx * dx + dy * dy + eps;
        const dist = Math.sqrt(distSq);
        const dist3 = distSq * dist;
        const f = (GM * 0.05 * bodyMass[j]) / dist3;
        newAx += f * dx;
        newAy += f * dy;
      }
    }

    // Step 3: Velocity-Verlet velocity update
    velX[i] += (accX[i] + newAx) * h_half;
    velY[i] += (accY[i] + newAy) * h_half;

    accX[i] = newAx;
    accY[i] = newAy;

    bodyAngle[i] = Math.atan2(posY[i], posX[i]);
  }
}

// ---- Audio Dispatch & Voice Slot Management (Strict 8-Voice Polyphony via js/poly.js) ----
function playPlanetVoice(bodyIdx, note, vel, durMs) {
  playVoice(bodyIdx, note, vel, durMs);
  voiceSlots[bodyIdx] = note;

  // Visual trigger animation
  triggerFlash[bodyIdx] = 1.0;
  triggerRipple[bodyIdx] = 6.0;
  triggerNoteName[bodyIdx] = midiName(note);
  starPulse = 1.0;

  // Modulate FM-1 CC #74 Brightness with total orbital kinetic energy
  const ccDest = state.orbitalCcDest ?? 74;
  const ccDepth = state.orbitalCcDepth ?? 80;
  if (ccDepth > 0) {
    const speed = Math.hypot(velX[bodyIdx], velY[bodyIdx]);
    const normSpeed = Math.min(1.0, Math.max(0.1, speed / 120.0));
    const ccVal = Math.min(127, Math.max(20, Math.round(normSpeed * ccDepth + (127 - ccDepth) * 0.25)));
    try {
      midi.sendControlChange(ccDest, ccVal);
    } catch (_) {}
  }
}

// Derives a scale-quantized pitch for planet body `i`
export function getPlanetNote(i) {
  const intervals = getActiveScaleIntervals();
  const root = getRootMidi();
  const num = Math.min(MAX_BODIES, Math.max(2, state.orbitalBodies ?? 5));
  const span = state.orbitalSpan ?? 3;
  const pitchMap = state.orbitalPitchMap || "orbit-rank";

  if (pitchMap === "polar-angle") {
    // True anomaly radial angle mapped to scale degrees
    const normTheta = (bodyAngle[i] + Math.PI) / (Math.PI * 2);
    const deg = Math.floor(normTheta * intervals.length * span);
    const octave = Math.floor(deg / intervals.length);
    const scaleDeg = deg % intervals.length;
    return quantize(root + octave * 12 + (intervals[scaleDeg] || 0));
  }

  if (pitchMap === "velocity") {
    // Current orbital velocity mapped across pitch span
    const speed = Math.hypot(velX[i], velY[i]);
    const normSpeed = Math.min(1.0, Math.max(0.0, (speed - 20) / 100));
    const deg = Math.floor(normSpeed * intervals.length * span);
    const octave = Math.floor(deg / intervals.length);
    const scaleDeg = deg % intervals.length;
    return quantize(root + octave * 12 + (intervals[scaleDeg] || 0));
  }

  // Default "orbit-rank": Innermost rapid orbits are high treble; outermost slow orbits are bass
  const invRank = (num - 1) - i;
  const deg = (i * 2) % intervals.length;
  const octOffset = Math.floor((invRank / Math.max(1, num - 1)) * (span - 1));
  return quantize(root + octOffset * 12 + (intervals[deg] || 0));
}

// ---- Free-Running Real-Time Animation Loop ----
function freeLoop(time) {
  const dt = Math.min(0.05, (time - lastFrameTime) / 1000) || 0.016;
  lastFrameTime = time;

  // Run continuous celestial physics and trigger checks when transport is playing
  if (isOrbitalPlaying) {
    stepVerlet(dt);
    checkOrbitalTriggers(dt);
  } else {
    // Subtle idle drift when stopped so the system is visibly alive
    stepVerlet(dt * 0.25);
  }

  // Decay visual trigger flashes and expand shockwave ripples
  for (let i = 0; i < MAX_BODIES; i++) {
    if (triggerFlash[i] > 0.01) {
      triggerFlash[i] *= 0.88;
      triggerRipple[i] += 48 * dt;
    } else {
      triggerFlash[i] = 0;
      triggerRipple[i] = 0;
      if (voiceSlots[i] === null) triggerNoteName[i] = "";
    }
  }

  if (starPulse > 0.01) {
    starPulse *= 0.92;
  } else {
    starPulse = 0;
  }

  renderOrbitCanvas(time);
  updateHud();

  animFrameId = requestAnimationFrame(freeLoop);
}

// Check periapsis transits and angular conjunctions
function checkOrbitalTriggers(dt) {
  const num = Math.min(MAX_BODIES, Math.max(2, state.orbitalBodies ?? 5));
  const triggerMode = state.orbitalTriggerMode || "both";
  const gateLen = state.orbitalGateLen ?? 220;

  // 1. Check Periapsis Transits (Closest approach: vr transitions from <= 0 to > 0)
  if (triggerMode === "periapsis" || triggerMode === "both") {
    for (let i = 0; i < num; i++) {
      const r = Math.hypot(posX[i], posY[i]);
      if (r < 1) continue;
      const vr = (posX[i] * velX[i] + posY[i] * velY[i]) / r;

      if (prevVr[i] <= 0 && vr > 0) {
        // Periapsis transit!
        const note = getPlanetNote(i);
        const speed = Math.hypot(velX[i], velY[i]);
        const vel = Math.min(127, Math.max(45, Math.round(speed * 0.95)));
        playPlanetVoice(i, note, vel, gateLen);
      }
      prevVr[i] = vr;
    }
  }

  // 2. Check Angular Conjunctions (Mutual radial alignments)
  if (state.orbitalConjunction && (triggerMode === "conjunction" || triggerMode === "both")) {
    const thresh = state.orbitalConjThresh ?? 0.08;
    for (let i = 0; i < num; i++) {
      for (let j = i + 1; j < num; j++) {
        let diff = Math.abs(bodyAngle[i] - bodyAngle[j]);
        if (diff > Math.PI) diff = Math.PI * 2 - diff;

        if (diff < thresh) {
          // Alignment detected: fire conjunction chime
          const noteI = getPlanetNote(i);
          playPlanetVoice(i, noteI, 90, gateLen);
        }
      }
    }
  }
}

// Retained for interface compatibility; note triggers are based on continuous orbital dynamics
export function onOrbitalLiveStep(step) {}

// ---- Bank Generator Contract (`return bank`) ----
// Note triggering is based on real-time continuous orbital dynamics; bank steps contain no step-clock notes.
export function generateOrbitalBank(st = state) {
  const seqLen = Math.max(1, Math.min(64, st?.length || 16));
  const bank = [];
  for (let s = 0; s < 16; s++) {
    const steps = [];
    for (let step = 0; step < seqLen; step++) {
      steps.push({
        notes: [],
        gate: false
      });
    }
    bank.push({
      length: seqLen,
      rate: st?.rate ?? 6,
      steps
    });
  }
  setBank(bank);
  return bank;
}

export function randomizeOrbital() {
  const p = ORBITAL_PRESETS[Math.floor(Math.random() * ORBITAL_PRESETS.length)];
  state.orbitalPreset = p.id;
  state.orbitalBodies = p.bodies;
  state.orbitalEccentricity = 0.1 + Math.random() * 0.45;
  state.orbitalSpeed = 0.8 + Math.random() * 0.8;
  state.modelSpeed = state.orbitalSpeed;
  state.orbitalGravity = 0.8 + Math.random() * 0.6;
  state.orbitalConjunction = Math.random() > 0.3;

  initPlanetarySystem(p.id);
  syncControlsFromState();
  renderOrbitCanvas();
  updateHud();
  status(`Randomized Orbital Resonance: ${p.name}`, "ok");
}

export function syncOrbitalFromRegen() {
  syncControlsFromState();
  renderOrbitCanvas();
  updateHud();
}

// ---- Canvas Rendering & Interactive Direct Manipulation ----
// ---- Canvas Rendering & Interactive Direct Manipulation ----
function renderOrbitCanvas(time = 0) {
  if (!orbitCanvas) return;
  const ctx = orbitCanvas.getContext("2d");
  if (!ctx) return;

  const w = orbitCanvas.width = orbitCanvas.clientWidth * (window.devicePixelRatio || 1);
  const h = orbitCanvas.height = orbitCanvas.clientHeight * (window.devicePixelRatio || 1);
  ctx.clearRect(0, 0, w, h);

  const cx = w * 0.5;
  const cy = h * 0.5;

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

  const num = Math.min(MAX_BODIES, Math.max(2, state.orbitalBodies ?? 5));
  const scaleFactor = Math.min(w, h) / 640.0;

  // 1. Draw central star (No gradients: flat concentric alpha rings with pulse)
  const starRadius = (14 + starPulse * 8) * scaleFactor;
  ctx.beginPath();
  ctx.arc(cx, cy, starRadius + 14 * scaleFactor, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(234, 179, 8, 0.12)";
  ctx.fill();

  ctx.beginPath();
  ctx.arc(cx, cy, starRadius + 6 * scaleFactor, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(234, 179, 8, 0.25)";
  ctx.fill();

  ctx.beginPath();
  ctx.arc(cx, cy, starRadius, 0, Math.PI * 2);
  ctx.fillStyle = starPulse > 0.3 ? "#ffffff" : "#eab308";
  ctx.fill();

  // Central Star Label
  ctx.fillStyle = colBg;
  ctx.font = `bold ${Math.round(9 * scaleFactor)}px monospace`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("SOL", cx, cy);

  // 3. Draw elliptical orbital tracks, flowing motion streams, and periapsis transit gates
  for (let i = 0; i < num; i++) {
    const a = semiMajor[i] * scaleFactor;
    const e = eccentricity[i];
    const b = a * Math.sqrt(Math.max(0.01, 1 - e * e));
    const c = a * e; // Distance from center to focal sun
    const isSelected = (i === hoveredBody || i === isDraggingBody);
    const isTriggered = triggerFlash[i] > 0.02;

    // Draw reference ellipse
    ctx.beginPath();
    ctx.ellipse(cx - c, cy, a, b, 0, 0, Math.PI * 2);

    if (isTriggered) {
      // Flashing illuminated orbit line on note trigger
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = bodyColor[i % bodyColor.length];
      ctx.globalAlpha = 0.6 + triggerFlash[i] * 0.4;
      ctx.stroke();
      ctx.globalAlpha = 1.0;
    } else {
      ctx.lineWidth = isSelected ? 2 : 1;
      ctx.strokeStyle = isSelected ? colLineFocus : colLine;
      ctx.stroke();

      // Flowing dashed particle stream indicating orbital velocity & travel direction
      ctx.save();
      ctx.setLineDash([4, 8]);
      ctx.lineDashOffset = -time * 0.035 * (1 + (num - i) * 0.35);
      ctx.strokeStyle = bodyColor[i % bodyColor.length];
      ctx.globalAlpha = 0.3;
      ctx.stroke();
      ctx.restore();
    }

    // Periapsis transit gate marker (closest approach to Sun)
    const periX = cx - c + a;
    const periY = cy;
    const gSize = 3.5 * scaleFactor;
    ctx.beginPath();
    ctx.moveTo(periX, periY - gSize);
    ctx.lineTo(periX + gSize, periY);
    ctx.lineTo(periX, periY + gSize);
    ctx.lineTo(periX - gSize, periY);
    ctx.closePath();
    ctx.strokeStyle = isTriggered ? "#ffffff" : bodyColor[i % bodyColor.length];
    ctx.lineWidth = isTriggered ? 2 : 1;
    ctx.stroke();

    // Draw motion trail
    const count = trailCounts[i];
    const head = trailHeads[i];
    if (count > 1) {
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = bodyColor[i % bodyColor.length];
      ctx.globalAlpha = 0.8;
      ctx.beginPath();
      for (let t = 0; t < count; t++) {
        const idx = (head - count + t + TRAIL_LEN) % TRAIL_LEN;
        const tx = cx + trailX[i * TRAIL_LEN + idx] * scaleFactor;
        const ty = cy + trailY[i * TRAIL_LEN + idx] * scaleFactor;
        if (t === 0) ctx.moveTo(tx, ty);
        else ctx.lineTo(tx, ty);
      }
      ctx.stroke();
      ctx.globalAlpha = 1.0;
    }
  }

  // 4. Draw radial conjunction alignment beams
  if (state.orbitalConjunction) {
    const thresh = state.orbitalConjThresh ?? 0.08;
    for (let i = 0; i < num; i++) {
      for (let j = i + 1; j < num; j++) {
        let diff = Math.abs(bodyAngle[i] - bodyAngle[j]);
        if (diff > Math.PI) diff = Math.PI * 2 - diff;
        if (diff < thresh) {
          ctx.strokeStyle = "rgba(255, 255, 255, 0.45)";
          ctx.lineWidth = 1;
          ctx.setLineDash([3, 3]);
          ctx.beginPath();
          ctx.moveTo(cx, cy);
          ctx.lineTo(cx + Math.cos(bodyAngle[i]) * 300 * scaleFactor, cy + Math.sin(bodyAngle[i]) * 300 * scaleFactor);
          ctx.stroke();
          ctx.setLineDash([]);
        }
      }
    }
  }

  // 5. Draw planet bodies, shockwaves, gravitational beams, and floating note badges
  for (let i = 0; i < num; i++) {
    const px = cx + posX[i] * scaleFactor;
    const py = cy + posY[i] * scaleFactor;
    const isSelected = (i === hoveredBody || i === isDraggingBody);
    const radius = (isSelected ? 9 : 6) * scaleFactor;
    const flash = triggerFlash[i];

    // Triggered visual effects: Gravitational tidal ray + Shockwave ring
    if (flash > 0.01) {
      // Gravitational beam from Sun to Planet
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(px, py);
      ctx.strokeStyle = bodyColor[i % bodyColor.length];
      ctx.globalAlpha = flash * 0.7;
      ctx.lineWidth = 1.8;
      ctx.stroke();
      ctx.globalAlpha = 1.0;

      // Expanding shockwave ripple ring
      ctx.beginPath();
      ctx.arc(px, py, triggerRipple[i] * scaleFactor, 0, Math.PI * 2);
      ctx.strokeStyle = bodyColor[i % bodyColor.length];
      ctx.globalAlpha = flash * 0.85;
      ctx.lineWidth = 1.8;
      ctx.stroke();
      ctx.globalAlpha = 1.0;

      // Outer glowing halo
      ctx.beginPath();
      ctx.arc(px, py, radius + 8 * scaleFactor, 0, Math.PI * 2);
      ctx.fillStyle = bodyColor[i % bodyColor.length];
      ctx.globalAlpha = flash * 0.4;
      ctx.fill();
      ctx.globalAlpha = 1.0;
    }

    // Active voice note indicator ring
    if (voiceSlots[i] !== null) {
      ctx.beginPath();
      ctx.arc(px, py, radius + 4 * scaleFactor, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(255, 255, 255, 0.4)";
      ctx.fill();
    }

    // Planet body circle
    ctx.beginPath();
    ctx.arc(px, py, radius, 0, Math.PI * 2);
    ctx.fillStyle = flash > 0.4 ? "#ffffff" : bodyColor[i % bodyColor.length];
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = isSelected ? "#ffffff" : colLine;
    ctx.stroke();

    // Planet index badge inside the body
    ctx.fillStyle = flash > 0.4 ? "#111215" : "#ffffff";
    ctx.font = `bold ${Math.round(8 * scaleFactor)}px monospace`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(i + 1), px, py);

    // Speed vector indicator
    ctx.strokeStyle = bodyColor[i % bodyColor.length];
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.lineTo(px + velX[i] * 0.15 * scaleFactor, py + velY[i] * 0.15 * scaleFactor);
    ctx.stroke();

    // Floating Note Name Badge above planet when sounding
    if (triggerNoteName[i]) {
      const noteText = triggerNoteName[i];
      const badgeY = py - (radius + 12 * scaleFactor);
      ctx.font = `bold ${Math.round(10 * scaleFactor)}px monospace`;
      const tw = ctx.measureText(noteText).width;
      const padX = 4 * scaleFactor;
      const padY = 2 * scaleFactor;

      ctx.fillStyle = colPanel2;
      ctx.strokeStyle = bodyColor[i % bodyColor.length];
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.rect(px - tw / 2 - padX, badgeY - 6 * scaleFactor - padY, tw + padX * 2, 12 * scaleFactor + padY * 2);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = "#ffffff";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(noteText, px, badgeY);
    }
  }
}

function updateHud() {
  if (bodiesCountDisplay) {
    const num = Math.min(MAX_BODIES, Math.max(2, state.orbitalBodies ?? 5));
    bodiesCountDisplay.textContent = `${num} / 8 BODIES`;
  }
}

function syncControlsFromState() {
  if (refs.orbitalBodies?.setValue) refs.orbitalBodies.setValue(state.orbitalBodies, false);
  if (refs.speed?.setValue) refs.speed.setValue(state.modelSpeed ?? state.orbitalSpeed ?? 1.0, false);
  if (refs.orbitalEccentricity?.setValue) refs.orbitalEccentricity.setValue(state.orbitalEccentricity, false);
  if (refs.orbitalGravity?.setValue) refs.orbitalGravity.setValue(state.orbitalGravity, false);
  if (refs.orbitalCcDepth?.setValue) refs.orbitalCcDepth.setValue(state.orbitalCcDepth, false);
  if (presetSelect) presetSelect.value = state.orbitalPreset || "laplace";
  if (notesSection?.sync) notesSection.sync();
}

// ---- UI Assembly & Model Initialization ----
export function initOrbital() {
  orbitalContainer = document.getElementById("model-orbital");
  if (!orbitalContainer) return;
  orbitalContainer.innerHTML = "";

  const layout = document.createElement("div");
  layout.className = "layout orbital-layout";

  // --- Left Column: Controls & Presets ---
  const module = document.createElement("div");
  module.className = "module orbital-module";

  // Card 1: Header, Mode Toggle, and Actions
  const headerCard = document.createElement("div");
  headerCard.className = "card";
  headerCard.style.padding = "8px 12px";

  const topRow = document.createElement("div");
  topRow.style.display = "flex";
  topRow.style.alignItems = "center";
  topRow.style.justifyContent = "space-between";

  const titleGroup = document.createElement("div");
  titleGroup.innerHTML = `<h3 style="margin:0; font-size:11px; font-weight:700; color:var(--accent); letter-spacing:1px; text-transform:uppercase;">Orbital Resonance</h3>`;

  const actionsGroup = document.createElement("div");
  actionsGroup.style.display = "flex";
  actionsGroup.style.gap = "4px";

  const btnRnd = document.createElement("button");
  btnRnd.className = "btn-action primary";
  btnRnd.style.fontSize = "10px";
  btnRnd.style.padding = "3px 8px";
  btnRnd.textContent = "Randomise";
  btnRnd.title = "Generate a new valid celestial resonance regime (or press R/G)";
  btnRnd.addEventListener("click", () => {
    randomizeOrbital();
  });

  actionsGroup.append(btnRnd);
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
  presetLabel.textContent = "ORBITS:";

  presetSelect = document.createElement("select");
  presetSelect.className = "lsystem-select";
  presetSelect.style.flex = "1";
  for (const pr of ORBITAL_PRESETS) {
    const opt = document.createElement("option");
    opt.value = pr.id;
    opt.textContent = pr.name;
    opt.title = pr.desc;
    presetSelect.appendChild(opt);
  }
  presetSelect.value = state.orbitalPreset || "laplace";
  presetSelect.addEventListener("change", (e) => {
    const pid = e.target.value;
    state.orbitalPreset = pid;
    const p = ORBITAL_PRESETS.find(pr => pr.id === pid);
    if (p) {
      state.orbitalBodies = p.bodies;
      state.orbitalEccentricity = p.ecc[0] ?? 0.2;
      state.orbitalGravity = p.gravity;
      state.orbitalSpeed = p.speed;
      state.modelSpeed = p.speed;
      if (refs.speed?.setValue) refs.speed.setValue(p.speed, false);
      initPlanetarySystem(pid);
      syncControlsFromState();
      renderOrbitCanvas();
      updateHud();
      status(`Orbital preset: ${p.name}`, "ok");
    }
  });

  presetRow.append(presetLabel, presetSelect);
  headerCard.append(topRow, presetRow);

  // Card 2: Celestial Parameters
  const paramCard = document.createElement("div");
  paramCard.className = "card";
  paramCard.style.padding = "8px 12px";
  paramCard.style.marginTop = "8px";

  const paramGrid = document.createElement("div");
  paramGrid.className = "lsystem-param-grid";

  const kBodies = knob({
    label: "BODIES",
    min: 2, max: 8, step: 1,
    value: state.orbitalBodies ?? 5,
    unit: "",
    title: "Number of active celestial bodies (strictly <= 8 voices)",
    onChange: (v) => {
      state.orbitalBodies = Math.round(v);
      initPlanetarySystem(state.orbitalPreset);
      renderOrbitCanvas();
      updateHud();
    }
  });
  R("orbitalBodies", kBodies);

  const kEcc = knob({
    label: "ECCENTRIC",
    min: 0.0, max: 0.85, step: 0.05,
    value: state.orbitalEccentricity ?? 0.25,
    unit: "e",
    title: "Orbital eccentricity (0 = circle, 0.85 = elongated ellipse)",
    onChange: (v) => {
      state.orbitalEccentricity = v;
      initPlanetarySystem(state.orbitalPreset);
      renderOrbitCanvas();
    }
  });
  R("orbitalEccentricity", kEcc);

  const kGrav = knob({
    label: "GRAVITY",
    min: 0.2, max: 2.5, step: 0.1,
    value: state.orbitalGravity ?? 1.0,
    unit: "G",
    title: "Central star gravitational constant (GM)",
    onChange: (v) => {
      state.orbitalGravity = v;
      initPlanetarySystem(state.orbitalPreset);
      renderOrbitCanvas();
    }
  });
  R("orbitalGravity", kGrav);

  const kCc = knob({
    label: "FM CC74",
    min: 0, max: 127, step: 1,
    value: state.orbitalCcDepth ?? 80,
    unit: "",
    title: "FM-1 CC #74 Brightness modulation depth driven by orbital kinetic energy",
    onChange: (v) => { state.orbitalCcDepth = v; }
  });
  R("orbitalCcDepth", kCc);

  const kGate = knob({
    label: "GATE",
    min: 80, max: 500, step: 10,
    value: state.orbitalGateLen ?? 220,
    unit: "ms",
    title: "Note duration gate length in milliseconds",
    onChange: (v) => { state.orbitalGateLen = v; }
  });
  R("orbitalGateLen", kGate);

  paramGrid.append(kBodies, kEcc, kGrav, kCc, kGate);
  paramCard.appendChild(paramGrid);

  // Card 3: Notes & Musical Pitch Controls
  notesSection = createNotesSection("orbital", () => {
    renderOrbitCanvas();
  });
  notesSection.sectEl.classList.add("card");
  notesSection.sectEl.style.padding = "8px 12px";
  notesSection.sectEl.style.marginTop = "8px";

  module.append(headerCard, paramCard, notesSection.sectEl);

  // --- Right Column: Interactive Orbital Canvas ---
  const display = document.createElement("div");
  display.className = "display orbital-display";

  const canvasCard = document.createElement("div");
  canvasCard.className = "card orbital-canvas-card";
  canvasCard.style.padding = "8px 12px";

  const canvasHeader = document.createElement("div");
  canvasHeader.style.display = "flex";
  canvasHeader.style.justifyContent = "space-between";
  canvasHeader.style.alignItems = "center";
  canvasHeader.style.marginBottom = "6px";
  canvasHeader.innerHTML = `
    <span style="font-size:10px; font-weight:700; color:var(--fg); letter-spacing:1px; text-transform:uppercase;">Keplerian Orbits &amp; Periapsis Phase Alignment</span>
    <span id="orbital-bodies-hud" style="font-size:9px; color:var(--accent); font-weight:700;">5 / 8 BODIES</span>
  `;
  bodiesCountDisplay = canvasHeader.querySelector("#orbital-bodies-hud");

  orbitCanvas = document.createElement("canvas");
  orbitCanvas.className = "orbital-canvas";
  orbitCanvas.style.width = "100%";
  orbitCanvas.style.height = "320px";
  orbitCanvas.style.display = "block";
  orbitCanvas.style.borderRadius = "4px";
  orbitCanvas.style.cursor = "crosshair";

  // Direct Manipulation: Drag planets to scrub orbital radii or phase angle
  const getCanvasCoords = (e) => {
    const rect = orbitCanvas.getBoundingClientRect();
    const w = rect.width;
    const h = rect.height;
    const scaleFactor = Math.min(w, h) / 640.0;
    const cx = w * 0.5;
    const cy = h * 0.5;
    const mx = (e.clientX - rect.left - cx) / scaleFactor;
    const my = (e.clientY - rect.top - cy) / scaleFactor;
    return { mx, my, dist: Math.hypot(mx, my), angle: Math.atan2(my, mx) };
  };

  orbitCanvas.addEventListener("pointerdown", (e) => {
    const { mx, my } = getCanvasCoords(e);
    const num = Math.min(MAX_BODIES, Math.max(2, state.orbitalBodies ?? 5));
    isDraggingBody = -1;

    // Check hit test against planet positions
    for (let i = 0; i < num; i++) {
      const d = Math.hypot(mx - posX[i], my - posY[i]);
      if (d < 24) {
        isDraggingBody = i;
        orbitCanvas.setPointerCapture(e.pointerId);
        break;
      }
    }

    if (isDraggingBody === -1) {
      // Clicked central sun: trigger pulse
      if (Math.hypot(mx, my) < 30) {
        starPulse = 1.0;
        const root = getRootMidi();
        playPlanetVoice(0, root, 100, 300);
      }
    }
  });

  orbitCanvas.addEventListener("pointermove", (e) => {
    const { mx, my, dist, angle } = getCanvasCoords(e);
    const num = Math.min(MAX_BODIES, Math.max(2, state.orbitalBodies ?? 5));

    if (isDraggingBody >= 0 && isDraggingBody < num) {
      const i = isDraggingBody;
      const newRadius = Math.max(40, Math.min(300, dist));
      semiMajor[i] = newRadius;
      bodyAngle[i] = angle;

      const e = eccentricity[i];
      const rPeri = Math.max(10, newRadius * (1 - e));
      const GM = 400000 * (state.orbitalGravity ?? 1.0);
      const vPeri = Math.sqrt((GM / newRadius) * ((1 + e) / Math.max(0.01, 1 - e)));

      posX[i] = dist * Math.cos(angle);
      posY[i] = dist * Math.sin(angle);
      velX[i] = -vPeri * Math.sin(angle);
      velY[i] = vPeri * Math.cos(angle);

      renderOrbitCanvas();
    } else {
      // Update hover state
      hoveredBody = -1;
      for (let i = 0; i < num; i++) {
        const d = Math.hypot(mx - posX[i], my - posY[i]);
        if (d < 18) {
          hoveredBody = i;
          break;
        }
      }
      renderOrbitCanvas();
    }
  });

  const stopDrag = (e) => {
    if (isDraggingBody >= 0) {
      try { orbitCanvas.releasePointerCapture(e.pointerId); } catch (_) {}
      isDraggingBody = -1;
      renderOrbitCanvas();
    }
  };

  orbitCanvas.addEventListener("pointerup", stopDrag);
  orbitCanvas.addEventListener("pointercancel", stopDrag);

  canvasCard.append(canvasHeader, orbitCanvas);
  display.appendChild(canvasCard);

  layout.append(module, display);
  orbitalContainer.appendChild(layout);

  initPlanetarySystem(state.orbitalPreset || "laplace");
  syncControlsFromState();
}

// ---- Model Activation Lifecycle ----
export function activateOrbitalModel() {
  setModelGenerator(generateOrbitalBank);
  setModelRandomizer(randomizeOrbital);
  setModelStepHandler(null);
  setModelTransportHandler({
    toggle: toggleOrbitalRunning,
    stop: stopOrbital,
    start: startOrbital,
    isRunning: isOrbitalRunning
  });

  doGenerate(false);
  renderOrbitCanvas();
  updateHud();

  if (!animFrameId) {
    lastFrameTime = performance.now();
    animFrameId = requestAnimationFrame(freeLoop);
  }

  updatePlayBtnUI();
  status("Orbital Resonance: Ready (Press Play or Spacebar to start)", "ok");
}

export function deactivateOrbitalModel() {
  stopOrbital();
  setModelStepHandler(null);
  setModelTransportHandler(null);
  setModelGenerator(null);
  setModelRandomizer(null);

  releasePolyVoices();
  voiceSlots.fill(null);
  triggerFlash.fill(0);
  triggerRipple.fill(0);
  triggerNoteName.fill("");
  lastLiveStep = -1;
  currentLiveStep = -1;

  if (animFrameId) {
    cancelAnimationFrame(animFrameId);
    animFrameId = null;
  }
}

// ---- Session Snapshot Integration ----
registerModel({
  id: "orbital",
  version: 1,
  migrations: {},
  capture() {
    return {
      bodies: state.orbitalBodies,
      speed: state.orbitalSpeed,
      eccentricity: state.orbitalEccentricity,
      gravity: state.orbitalGravity,
      conjunction: state.orbitalConjunction,
      conjThresh: state.orbitalConjThresh,
      triggerMode: state.orbitalTriggerMode,
      pitchMap: state.orbitalPitchMap,
      preset: state.orbitalPreset,
      mode: state.orbitalMode,
      span: state.orbitalSpan,
      ccDepth: state.orbitalCcDepth,
      gateLen: state.orbitalGateLen
    };
  },
  restore(h) {
    if (h?.bodies !== undefined) state.orbitalBodies = h.bodies;
    if (h?.speed !== undefined) state.orbitalSpeed = h.speed;
    if (h?.eccentricity !== undefined) state.orbitalEccentricity = h.eccentricity;
    if (h?.gravity !== undefined) state.orbitalGravity = h.gravity;
    if (h?.conjunction !== undefined) state.orbitalConjunction = h.conjunction;
    if (h?.conjThresh !== undefined) state.orbitalConjThresh = h.conjThresh;
    if (h?.triggerMode !== undefined) state.orbitalTriggerMode = h.triggerMode;
    if (h?.pitchMap !== undefined) state.orbitalPitchMap = h.pitchMap;
    if (h?.preset !== undefined) state.orbitalPreset = h.preset;
    if (h?.mode !== undefined) state.orbitalMode = h.mode;
    if (h?.span !== undefined) state.orbitalSpan = h.span;
    if (h?.ccDepth !== undefined) state.orbitalCcDepth = h.ccDepth;
    if (h?.gateLen !== undefined) state.orbitalGateLen = h.gateLen;

    initPlanetarySystem(state.orbitalPreset || "laplace");
    syncControlsFromState();
    renderOrbitCanvas();
    updateHud();
  }
});
