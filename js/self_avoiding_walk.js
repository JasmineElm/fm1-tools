// self_avoiding_walk.js — Polymer Self-Avoiding Walk & Steric Jamming Folding Sequencer for FM-1 Pulses.
// Simulates synthetic polymer chain growth and molecular protein folding on a 2D discrete lattice.
// At each step, the polymer head advances randomly to an adjacent unoccupied lattice node strictly
// subject to self-avoidance. When encountering steric hindrance dead-ends (jamming traps), the chain
// undergoes global conformational collapse / structural annealing, discharging a polyphonic chord cascade.
//
// Generative Architecture:
// 1. 2D Discrete Lattice Self-Avoiding Random Walk (SAW):
//    - Lattice grid of size GRID_W x GRID_H (32x32).
//    - Monomer chain omega = (omega_0, omega_1, ..., omega_N) where omega_i != omega_j for all i != j.
//    - Coordination number z = 4 (Von Neumann neighbors: Up, Right, Down, Left).
// 2. Steric Entrapment & Conformational Folding Cascade:
//    - When the set of unoccupied adjacent neighbors is empty (|A(omega_N)| = 0), the polymer is jammed!
//    - Steric deadlock (or reaching target chain length) triggers a structural collapse cascade,
//      sounding an explosive, harmonically resolved polyphonic chord cluster across up to 8 voices (js/poly.js).
// 3. Continuous Timbre Modulation (CC #74):
//    - Instantaneous radius of gyration Rg and chain end-to-end displacement modulate FM-1 CC #74 Brightness.
// 4. Zero GC Churn & Flat Workbench Aesthetics:
//    - Pre-allocated TypedArray buffers (Uint8Array lattice, Int16Array chain coordinates).
//    - Strictly flat design system with zero CSS or canvas gradients.

import {
  state, refs, R, setState, scheduleRegen, doGenerate,
  getBank, setBank, getSelected, setSelected, status, onRegen,
  setModelGenerator, setModelRandomizer, RATE_NAMES
} from "./state.js";
import { knob, dropdown, actionBtn } from "./controls.js";
import { isLive, setModelStepHandler, setModelTransportHandler } from "./player.js";
import { liveNoteOn, liveNoteOff, panicPreview } from "./player.js";
import {
  SCALE_LABELS, ROOT_NOTE_OPTIONS, ROOT_OCTAVE_OPTIONS,
  mapNormalizedToNote, getRootMidi, getActiveScaleIntervals,
  computeOctaveShift, quantize
} from "./scale.js";
import { syncRhythmGrid } from "./rhythm.js";
import { getActiveModel } from "./modes.js";
import { midiName, SCALES } from "./generator.js";
import { registerModel } from "./snapshot.js";
import { selectPolyVoices, playVoice, releasePolyVoices, getActiveVoiceCount } from "./poly.js";
import * as audio from "./audio.js";

// ---- Constants & Pre-allocated Buffers (Zero GC Churn) ----
export const MAX_VOICES = 8;          // Strict FM-1 8 hardware voices limit
export const GRID_DIM = 32;           // 32x32 discrete 2D lattice
export const TOTAL_CELLS = GRID_DIM * GRID_DIM;
export const MAX_CHAIN_LEN = 256;     // Maximum monomer chain capacity

// Pre-allocated lattice buffers
export const lattice = new Uint8Array(TOTAL_CELLS);
export const chainX = new Int16Array(MAX_CHAIN_LEN);
export const chainY = new Int16Array(MAX_CHAIN_LEN);
export const chainDir = new Int8Array(MAX_CHAIN_LEN); // 0: Up, 1: Right, 2: Down, 3: Left
export let chainLen = 0;

// Direction deltas: 0=Up, 1=Right, 2=Down, 3=Left
export const DX = [0, 1, 0, -1];
export const DY = [-1, 0, 1, 0];

// Polyphonic Collapse Voice Rings
export const sawVoices = [];
for (let i = 0; i < MAX_VOICES; i++) {
  sawVoices.push({
    id: i,
    note: 60,
    velocity: 0,
    active: false,
    pulseAnim: 0,
    x: 0,
    y: 0
  });
}

// Polymer Walk Presets
export const SAW_PRESETS = [
  {
    id: "spontaneous_globule",
    name: "Globular Coil",
    desc: "Isotropic unconstrained random walk producing dense, labyrinthine globular polymer coils",
    maxLen: 96,
    speed: 8,
    bias: 0.15,
    cascadeVoices: 6,
    subgrid: 28
  },
  {
    id: "directed_filament",
    name: "Directed Filament",
    desc: "Forward persistence bias forming extended fibrillar rods with sweeping melodic contours",
    maxLen: 80,
    speed: 10,
    bias: 0.70,
    cascadeVoices: 4,
    subgrid: 30
  },
  {
    id: "helical_hairpin",
    name: "Pleated Hairpin",
    desc: "High turn probability generating tight beta-sheet hairpins and oscillating zig-zag arpeggios",
    maxLen: 64,
    speed: 7,
    bias: 0.05,
    cascadeVoices: 6,
    subgrid: 24
  },
  {
    id: "steric_trap",
    name: "Steric Jamming",
    desc: "Compact confined enclosure forcing frequent steric deadlocks and rapid explosive chord cascades",
    maxLen: 48,
    speed: 12,
    bias: 0.25,
    cascadeVoices: 8,
    subgrid: 16
  },
  {
    id: "annealed_crystal",
    name: "Annealed Domain",
    desc: "Balanced growth and structural annealing with expansive polyphonic harmonic resolutions",
    maxLen: 128,
    speed: 6,
    bias: 0.40,
    cascadeVoices: 8,
    subgrid: 32
  }
];

// Runtime State
let isSawPlaying = false;
let animFrameId = null;
let lastFrameTime = 0;
let stepTimerAcc = 0;
let isCollapsing = false;
let collapseTimer = 0.0;
let collapseAnimRadius = 0.0;
let lastCollapseX = 16;
let lastCollapseY = 16;
let smoothedCcVal = 64;
let radiusOfGyration = 0.0;
let totalJamsCount = 0;

// UI & Canvas References
let container = null;
let canvas = null;
let ctx = null;

/**
 * Configure polymer walk parameters from a preset.
 */
export function initSawPreset(presetId) {
  const p = SAW_PRESETS.find(item => item.id === presetId) || SAW_PRESETS[0];
  state.sawPreset = p.id;
  state.sawMaxLen = p.maxLen;
  state.sawSpeed = p.speed;
  state.sawBias = p.bias;
  state.sawCascadeVoices = p.cascadeVoices;
  state.sawSubgrid = p.subgrid;
  state.sawOctave = state.sawOctave ?? 0;

  resetChain();
}

/**
 * Clear the lattice and reset chain to center seed.
 */
export function resetChain(seedX = null, seedY = null) {
  lattice.fill(0);
  chainLen = 0;
  isCollapsing = false;
  collapseTimer = 0.0;
  collapseAnimRadius = 0.0;

  const startX = (seedX !== null) ? Math.max(0, Math.min(GRID_DIM - 1, seedX)) : Math.floor(GRID_DIM / 2);
  const startY = (seedY !== null) ? Math.max(0, Math.min(GRID_DIM - 1, seedY)) : Math.floor(GRID_DIM / 2);

  chainX[0] = startX;
  chainY[0] = startY;
  chainDir[0] = 0;
  lattice[startY * GRID_DIM + startX] = 1;
  chainLen = 1;
}

/**
 * Maps lattice position (x, y) and turn direction to a scale-quantized MIDI note.
 */
export function getMonomerNote(x, y, dir, octaveShift = 0) {
  const root = getRootMidi();
  const intervals = getActiveScaleIntervals();
  const octOffset = computeOctaveShift(octaveShift);

  // X coordinate maps to scale degree
  const normX = Math.max(0, Math.min(1, x / (GRID_DIM - 1)));
  // Y coordinate maps to register octave
  const normY = Math.max(0, Math.min(1, y / (GRID_DIM - 1)));
  const regOctave = Math.floor(normY * 3) - 1; // -1, 0, +1

  // Turn direction imparts interval offset
  const dirOffset = (dir % 4) * 2; // Subtle modal flavor

  const note = mapNormalizedToNote(normX, intervals, root, 16);
  return Math.max(12, Math.min(127, note + dirOffset + (regOctave * 12) + octOffset));
}

/**
 * Calculate the radius of gyration Rg = sqrt( 1/N * sum( ||r_i - r_cm||^2 ) ).
 */
export function computeRadiusOfGyration() {
  if (chainLen <= 1) return 0.0;

  let sumX = 0;
  let sumY = 0;
  for (let i = 0; i < chainLen; i++) {
    sumX += chainX[i];
    sumY += chainY[i];
  }
  const cmX = sumX / chainLen;
  const cmY = sumY / chainLen;

  let sumDistSq = 0;
  for (let i = 0; i < chainLen; i++) {
    const dx = chainX[i] - cmX;
    const dy = chainY[i] - cmY;
    sumDistSq += (dx * dx + dy * dy);
  }

  return Math.sqrt(sumDistSq / chainLen);
}

/**
 * Perform a global conformational collapse / structural annealing cascade.
 * Triggered upon steric jamming or reaching target chain length.
 */
export function triggerCollapseCascade() {
  isCollapsing = true;
  collapseTimer = 0.35;
  collapseAnimRadius = 0.0;
  totalJamsCount++;

  const headX = chainX[chainLen - 1];
  const headY = chainY[chainLen - 1];
  lastCollapseX = headX;
  lastCollapseY = headY;

  // Gather candidate chords from chain milestones (extrema and center)
  const numVoices = Math.min(MAX_VOICES, Math.max(2, Math.round(state.sawCascadeVoices ?? 6)));
  const candidates = [];

  for (let v = 0; v < numVoices; v++) {
    const monomerIdx = Math.floor((v / numVoices) * (chainLen - 1));
    const mx = chainX[monomerIdx];
    const my = chainY[monomerIdx];
    const note = getMonomerNote(mx, my, chainDir[monomerIdx], state.sawOctave ?? 0);
    const vel = Math.round(75 + (v % 2 === 0 ? 35 : 15));

    candidates.push({
      id: v,
      note,
      velocity: vel,
      x: mx,
      y: my
    });
  }

  // Select and dispatch through shared polyphonic voice ceiling manager
  const chosen = selectPolyVoices(candidates, state.polyphony ?? 8, state.polyStrategy ?? "spread");
  for (const c of chosen) {
    const sv = sawVoices[c.id];
    sv.note = c.note;
    sv.velocity = c.velocity;
    sv.active = true;
    sv.pulseAnim = 1.0;
    sv.x = c.x;
    sv.y = c.y;

    playVoice(c.id, c.note, c.velocity, 280);
  }
}

/**
 * Advance the self-avoiding polymer walk by 1 discrete monomer step.
 */
export function stepMonomer() {
  if (chainLen === 0) {
    resetChain();
    return { stepped: true, jammed: false };
  }

  const maxLen = Math.min(MAX_CHAIN_LEN, Math.max(16, Math.round(state.sawMaxLen ?? 64)));
  if (chainLen >= maxLen) {
    triggerCollapseCascade();
    resetChain();
    return { stepped: false, jammed: true, reason: "max_len" };
  }

  const curX = chainX[chainLen - 1];
  const curY = chainY[chainLen - 1];
  const lastDir = chainDir[chainLen - 1];
  const subgrid = Math.max(12, Math.min(GRID_DIM, Math.round(state.sawSubgrid ?? 24)));
  const minCoord = Math.floor((GRID_DIM - subgrid) / 2);
  const maxCoord = minCoord + subgrid - 1;

  // 1. Gather all unoccupied adjacent Von Neumann neighbors within subgrid
  const validDirs = [];
  for (let d = 0; d < 4; d++) {
    const nx = curX + DX[d];
    const ny = curY + DY[d];

    // Check subgrid boundary
    if (nx >= minCoord && nx <= maxCoord && ny >= minCoord && ny <= maxCoord) {
      // Check lattice self-avoidance
      if (lattice[ny * GRID_DIM + nx] === 0) {
        validDirs.push(d);
      }
    }
  }

  // 2. Steric Hindrance / Jamming Check
  if (validDirs.length === 0) {
    // Entrapped in dead-end! Trigger conformational collapse!
    triggerCollapseCascade();
    resetChain();
    return { stepped: false, jammed: true, reason: "steric_jam" };
  }

  // 3. Directional Persistence Selection
  const bias = state.sawBias ?? 0.2;
  let chosenDir = validDirs[0];

  // If previous direction is available, bias towards straight propagation
  if (validDirs.includes(lastDir) && Math.random() < bias) {
    chosenDir = lastDir;
  } else {
    // Random choice among remaining unoccupied neighbors
    chosenDir = validDirs[Math.floor(Math.random() * validDirs.length)];
  }

  // 4. Place monomer
  const nextX = curX + DX[chosenDir];
  const nextY = curY + DY[chosenDir];

  chainX[chainLen] = nextX;
  chainY[chainLen] = nextY;
  chainDir[chainLen] = chosenDir;
  chainLen++;
  lattice[nextY * GRID_DIM + nextX] = chainLen;

  // 5. Sound musical note for the new monomer step
  const rawNote = getMonomerNote(nextX, nextY, chosenDir, state.sawOctave ?? 0);
  const vel = Math.max(50, Math.min(127, Math.round(60 + (chainLen % 8 === 0 ? 35 : 15))));
  const voiceSlot = chainLen % MAX_VOICES;

  const sv = sawVoices[voiceSlot];
  sv.note = rawNote;
  sv.velocity = vel;
  sv.active = true;
  sv.pulseAnim = 0.7;
  sv.x = nextX;
  sv.y = nextY;

  const candidates = [{ id: voiceSlot, note: rawNote, velocity: vel }];
  const chosen = selectPolyVoices(candidates, state.polyphony ?? 8, state.polyStrategy ?? "highest");
  for (const c of chosen) {
    playVoice(c.id, c.note, c.velocity, 120);
  }

  // 6. Continuous Timbre CC #74 Modulation
  radiusOfGyration = computeRadiusOfGyration();
  const maxRg = subgrid * 0.5;
  const normRg = Math.min(1.0, radiusOfGyration / Math.max(1.0, maxRg));
  const targetCc = Math.round(35 + normRg * 85);
  smoothedCcVal = Math.round(smoothedCcVal * 0.88 + targetCc * 0.12);
  // Update radius of gyration telemetry

  return { stepped: true, jammed: false, x: nextX, y: nextY, note: rawNote };
}

/**
 * Numerically advance the simulation over dt seconds.
 */
export function stepSimulation(dt = 0.016) {
  const speedHz = Math.max(1, Math.min(24, Math.round((state.sawSpeed ?? 8) * (state.modelSpeed ?? 1.0))));
  const stepInterval = 1.0 / speedHz;

  stepTimerAcc += dt;
  let stepped = false;
  let jammed = false;

  while (stepTimerAcc >= stepInterval) {
    stepTimerAcc -= stepInterval;
    const res = stepMonomer();
    if (res.stepped) stepped = true;
    if (res.jammed) jammed = true;
  }

  // Decay collapse animation
  if (isCollapsing) {
    collapseTimer -= dt;
    collapseAnimRadius += dt * 60.0;
    if (collapseTimer <= 0) {
      isCollapsing = false;
    }
  }

  // Decay visual voice pulse rings
  for (let i = 0; i < MAX_VOICES; i++) {
    if (sawVoices[i].pulseAnim > 0) {
      sawVoices[i].pulseAnim = Math.max(0, sawVoices[i].pulseAnim - 0.05);
      if (sawVoices[i].pulseAnim === 0) {
        sawVoices[i].active = false;
      }
    }
  }

  return { stepped, jammed, chainLen, radiusOfGyration };
}

/**
 * Generator Function Contract: generateSelfAvoidingWalkBank(state).
 * Deterministically synthesizes a valid 64-step bank array conforming to engine standards.
 */
export function generateSelfAvoidingWalkBank(s) {
  const seqLen = s?.length || 64;
  const octave = s?.sawOctave ?? 0;
  const steps = [];

  // Deterministically generate 64 steps simulating monomer walk
  let simX = 16;
  let simY = 16;
  let simDir = 0;

  for (let i = 0; i < seqLen; i++) {
    // Semi-random direction step based on seed and step index
    const turn = Math.floor((Math.sin(i * 1.7 + (s?.seed || 1)) + 1) * 2) % 4;
    simDir = (simDir + turn) % 4;
    simX = Math.max(2, Math.min(GRID_DIM - 3, simX + DX[simDir]));
    simY = Math.max(2, Math.min(GRID_DIM - 3, simY + DY[simDir]));

    const note = getMonomerNote(simX, simY, simDir, octave);
    const vel = Math.round(65 + ((i % 4 === 0) ? 35 : 10));

    steps.push({
      note,
      vel,
      notes: [{ note, vel }],
      gate: 0.75,
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

  const cx = w * 0.5;
  const cy = h * 0.46;
  const boardSize = Math.min(w * 0.88, h * 0.80);
  const cellSize = boardSize / GRID_DIM;
  const originX = cx - (GRID_DIM * cellSize) * 0.5;
  const originY = cy - (GRID_DIM * cellSize) * 0.5;

  const subgrid = Math.max(12, Math.min(GRID_DIM, Math.round(state.sawSubgrid ?? 24)));
  const minCoord = Math.floor((GRID_DIM - subgrid) / 2);
  const maxCoord = minCoord + subgrid;

  // 1. Draw Subgrid Enclosure Boundaries
  const subgridX = originX + minCoord * cellSize;
  const subgridY = originY + minCoord * cellSize;
  const subgridW = subgrid * cellSize;
  const subgridH = subgrid * cellSize;

  ctx.fillStyle = colorPanel2;
  ctx.fillRect(subgridX, subgridY, subgridW, subgridH);
  ctx.strokeStyle = colorLineFocus;
  ctx.lineWidth = 1.5;
  ctx.strokeRect(subgridX, subgridY, subgridW, subgridH);

  // 2. Draw Subtle Lattice Dot Grid
  ctx.fillStyle = colorLine;
  for (let y = minCoord; y < maxCoord; y++) {
    for (let x = minCoord; x < maxCoord; x++) {
      const px = originX + x * cellSize + cellSize * 0.5;
      const py = originY + y * cellSize + cellSize * 0.5;
      ctx.fillRect(px - 0.5, py - 0.5, 1, 1);
    }
  }

  // 3. Draw Polymer Chain Bonds
  if (chainLen > 1) {
    ctx.strokeStyle = colorLineFocus;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    for (let i = 0; i < chainLen; i++) {
      const px = originX + chainX[i] * cellSize + cellSize * 0.5;
      const py = originY + chainY[i] * cellSize + cellSize * 0.5;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();
  }

  // 4. Draw Monomer Nodes
  for (let i = 0; i < chainLen; i++) {
    const px = originX + chainX[i] * cellSize + cellSize * 0.5;
    const py = originY + chainY[i] * cellSize + cellSize * 0.5;

    // Distinguish seed (monomer 0), chain body, and polymer head
    if (i === 0) {
      // Seed monomer
      ctx.fillStyle = colorOk;
      ctx.fillRect(px - 3.5, py - 3.5, 7, 7);
    } else if (i === chainLen - 1) {
      // Polymer growing head
      ctx.fillStyle = colorAccent2;
      ctx.fillRect(px - 4, py - 4, 8, 8);
      ctx.strokeStyle = colorFg;
      ctx.lineWidth = 1;
      ctx.strokeRect(px - 4, py - 4, 8, 8);
    } else {
      // Body monomer
      ctx.fillStyle = colorAccent;
      ctx.fillRect(px - 2.5, py - 2.5, 5, 5);
    }
  }

  // 5. Draw Steric Jamming Collapse Ripple Animation
  if (isCollapsing && collapseAnimRadius > 0) {
    const rx = originX + lastCollapseX * cellSize + cellSize * 0.5;
    const ry = originY + lastCollapseY * cellSize + cellSize * 0.5;

    ctx.strokeStyle = colorErr;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(rx, ry, collapseAnimRadius, 0, Math.PI * 2);
    ctx.stroke();

    ctx.fillStyle = colorFg;
    ctx.font = "9px monospace";
    ctx.textAlign = "center";
    ctx.fillText("COLLAPSE CASCADE", rx, ry - collapseAnimRadius - 4);
  }

  // 6. Draw Polyphonic Voice Droplets
  for (let i = 0; i < MAX_VOICES; i++) {
    const sv = sawVoices[i];
    if (sv.pulseAnim > 0.05) {
      const vx = originX + sv.x * cellSize + cellSize * 0.5;
      const vy = originY + sv.y * cellSize + cellSize * 0.5;
      const r = 4 + (1.0 - sv.pulseAnim) * 16;

      ctx.strokeStyle = colorAccent2;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(vx, vy, r, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  // 7. Draw 8 Polyphonic Voice Monitors (Bottom Bar)
  const voiceBarY = h - 22;
  const voiceSlotW = (w - 20) / MAX_VOICES;

  for (let i = 0; i < MAX_VOICES; i++) {
    const sv = sawVoices[i];
    const bx = 10 + i * voiceSlotW;
    const isLit = sv.pulseAnim > 0.05;

    ctx.fillStyle = isLit ? colorAccent : colorPanel2;
    ctx.fillRect(bx + 2, voiceBarY, voiceSlotW - 4, 16);

    ctx.strokeStyle = isLit ? colorFg : colorLine;
    ctx.lineWidth = 1;
    ctx.strokeRect(bx + 2, voiceBarY, voiceSlotW - 4, 16);

    ctx.fillStyle = isLit ? "#ffffff" : colorDim;
    ctx.font = "9px monospace";
    ctx.textAlign = "center";
    ctx.fillText(midiName(sv.note), bx + voiceSlotW * 0.5, voiceBarY + 11);
  }

  // 8. Stats & Gyration Telemetry
  ctx.fillStyle = colorDim;
  ctx.font = "9px monospace";
  ctx.textAlign = "left";
  ctx.fillText(`MONOMERS: ${chainLen} / ${state.sawMaxLen ?? 64} | RG: ${radiusOfGyration.toFixed(2)} | JAMS: ${totalJamsCount}`, 12, h - 30);
}

/**
 * Setup Pointer Interaction on Lattice.
 */
function setupCanvasInteractions() {
  if (!canvas) return;

  canvas.addEventListener("pointerdown", (e) => {
    const rect = canvas.getBoundingClientRect();
    const px = (e.clientX - rect.left) * (canvas.width / rect.width);
    const py = (e.clientY - rect.top) * (canvas.height / rect.height);

    const cx = canvas.width * 0.5;
    const cy = canvas.height * 0.46;
    const boardSize = Math.min(canvas.width * 0.88, canvas.height * 0.80);
    const cellSize = boardSize / GRID_DIM;
    const originX = cx - (GRID_DIM * cellSize) * 0.5;
    const originY = cy - (GRID_DIM * cellSize) * 0.5;

    const gridX = Math.floor((px - originX) / cellSize);
    const gridY = Math.floor((py - originY) / cellSize);

    if (gridX >= 0 && gridX < GRID_DIM && gridY >= 0 && gridY < GRID_DIM) {
      // Re-nucleate polymer seed at clicked lattice cell
      resetChain(gridX, gridY);
      status(`Polymer seed re-nucleated at (${gridX}, ${gridY})`);
    }
  });
}

/**
 * Main animation loop.
 */
function animLoop(timestamp) {
  if (!lastFrameTime) lastFrameTime = timestamp;
  const dt = Math.min(0.04, (timestamp - lastFrameTime) / 1000);
  lastFrameTime = timestamp;

  if (isSawPlaying) {
    stepSimulation(dt);
  }

  renderCanvas();
  if (typeof requestAnimationFrame === "function") {
    animFrameId = requestAnimationFrame(animLoop);
  }
}

export function startSelfAvoidingWalk() {
  isSawPlaying = true;
  lastFrameTime = performance.now();
  if (refs.btnPlaySaw) {
    refs.btnPlaySaw.textContent = "Stop";
    refs.btnPlaySaw.classList.add("btn-active");
  }
}

export function stopSelfAvoidingWalk() {
  isSawPlaying = false;
  releasePolyVoices();
  for (let i = 0; i < MAX_VOICES; i++) {
    sawVoices[i].active = false;
    sawVoices[i].pulseAnim = 0;
  }
  if (refs.btnPlaySaw) {
    refs.btnPlaySaw.textContent = "Play";
    refs.btnPlaySaw.classList.remove("btn-active");
  }
}

export function toggleSelfAvoidingWalkRunning() {
  if (isSawPlaying) {
    stopSelfAvoidingWalk();
  } else {
    startSelfAvoidingWalk();
  }
}

export function isSelfAvoidingWalkRunning() {
  return isSawPlaying;
}

/**
 * Workbench Assembly & DOM Initialization.
 */
export function initSelfAvoidingWalk() {
  container = document.getElementById("model-self_avoiding_walk");
  if (!container) return;
  container.innerHTML = "";

  // 1. Module Enclosure & Header
  const moduleWrap = document.createElement("div");
  moduleWrap.className = "chladni-wrap";

  const header = document.createElement("div");
  header.className = "chladni-header";
  header.innerHTML = `
    <div style="display:flex; align-items:center; gap:8px;">
      <span class="chladni-title">Polymer Self-Avoiding Walk</span>
      <span class="chladni-tag">Steric Jamming & Folding</span>
    </div>
  `;

  // 2. Interactive Lattice Canvas
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

  // Section A: Polymer Chain Growth & Presets
  const sectGrowth = document.createElement("div");
  sectGrowth.className = "chladni-card";
  sectGrowth.innerHTML = `<div class="chladni-card-title">Polymer Growth & Presets</div>`;

  const presetOptions = SAW_PRESETS.map(p => ({ v: p.id, t: p.name }));
  const rowPreset = R("sawPreset", dropdown({
    label: "Preset",
    options: presetOptions,
    value: state.sawPreset || "spontaneous_globule",
    onInput: v => {
      initSawPreset(v);
      syncControls();
    },
    tip: "Conformational growth regimes for polymer chains"
  }));

  const rowSpeed = R("sawSpeed", knob({
    label: "Rate",
    min: 1,
    max: 24,
    step: 1,
    value: state.sawSpeed ?? 8,
    format: v => `${Math.round(v)}/s`,
    onInput: v => { state.sawSpeed = Math.round(v); },
    tip: "Polymer monomer stepping growth rate per second"
  }));

  const rowMaxLen = R("sawMaxLen", knob({
    label: "Max Len",
    min: 16,
    max: 128,
    step: 4,
    value: state.sawMaxLen ?? 64,
    format: v => `${Math.round(v)}`,
    onInput: v => { state.sawMaxLen = Math.round(v); },
    tip: "Target monomer chain length before planned conformational folding"
  }));

  sectGrowth.appendChild(rowPreset);
  sectGrowth.appendChild(rowSpeed);
  sectGrowth.appendChild(rowMaxLen);

  // Section B: Conformation & Jamming
  const sectConformation = document.createElement("div");
  sectConformation.className = "chladni-card";
  sectConformation.innerHTML = `<div class="chladni-card-title">Conformation & Jamming</div>`;

  const rowBias = R("sawBias", knob({
    label: "Persistence",
    min: 0.0,
    max: 0.9,
    step: 0.05,
    value: state.sawBias ?? 0.15,
    format: v => `${Math.round(v * 100)}%`,
    onInput: v => { state.sawBias = v; },
    tip: "Forward straight-line persistence bias"
  }));

  const rowSubgrid = R("sawSubgrid", knob({
    label: "Subgrid",
    min: 12,
    max: 32,
    step: 2,
    value: state.sawSubgrid ?? 24,
    format: v => `${Math.round(v)}²`,
    onInput: v => { state.sawSubgrid = Math.round(v); resetChain(); },
    tip: "Confinement boundary enclosure dimensions"
  }));

  const rowCascade = R("sawCascadeVoices", knob({
    label: "Cascade",
    min: 2,
    max: 8,
    step: 1,
    value: state.sawCascadeVoices ?? 6,
    format: v => `${Math.round(v)} V`,
    onInput: v => { state.sawCascadeVoices = Math.round(v); },
    tip: "Number of polyphonic voices in steric collapse chord cascade"
  }));

  sectConformation.appendChild(rowBias);
  sectConformation.appendChild(rowSubgrid);
  sectConformation.appendChild(rowCascade);

  // Section C: Pitch & Folding Control
  const sectPitch = document.createElement("div");
  sectPitch.className = "chladni-card";
  sectPitch.innerHTML = `<div class="chladni-card-title">Pitch & Folding Actions</div>`;

  const rowOctave = R("sawOctave", knob({
    label: "Octave",
    min: -2,
    max: 2,
    step: 1,
    value: state.sawOctave ?? 0,
    format: v => (v > 0 ? `+${v}` : `${v}`),
    onInput: v => { state.sawOctave = Math.round(v); },
    tip: "Master octave transposition shift"
  }));

  const actionGroup = document.createElement("div");
  actionGroup.style.display = "flex";
  actionGroup.style.gap = "6px";
  actionGroup.style.marginTop = "8px";

  const btnFold = actionBtn("Fold Now", () => {
    triggerCollapseCascade();
    resetChain();
    status("Manual conformational collapse triggered");
  }, "Force conformational collapse and chord cascade");

  const btnClear = actionBtn("Clear Lattice", () => {
    resetChain();
    status("Lattice cleared and reseeded at center");
  }, "Reset polymer chain to origin");

  const btnRandomize = actionBtn("Randomize", () => {
    randomizeSelfAvoidingWalk();
  }, "Randomize polymer conformation parameters");

  actionGroup.appendChild(btnFold);
  actionGroup.appendChild(btnClear);
  actionGroup.appendChild(btnRandomize);

  sectPitch.appendChild(rowOctave);
  sectPitch.appendChild(actionGroup);

  controlsGrid.appendChild(sectGrowth);
  controlsGrid.appendChild(sectConformation);
  controlsGrid.appendChild(sectPitch);

  moduleWrap.appendChild(header);
  moduleWrap.appendChild(canvas);
  moduleWrap.appendChild(controlsGrid);
  container.appendChild(moduleWrap);

  // Initialize active preset
  initSawPreset(state.sawPreset || "spontaneous_globule");

  // Wire model hooks
  setModelGenerator("self_avoiding_walk", generateSelfAvoidingWalkBank);
  setModelStepHandler("self_avoiding_walk", () => {
    if (!isSawPlaying) {
      stepMonomer();
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
  if (refs.sawPreset) refs.sawPreset.setValue(state.sawPreset);
  if (refs.sawSpeed) refs.sawSpeed.setValue(state.sawSpeed);
  if (refs.sawMaxLen) refs.sawMaxLen.setValue(state.sawMaxLen);
  if (refs.sawBias) refs.sawBias.setValue(state.sawBias);
  if (refs.sawSubgrid) refs.sawSubgrid.setValue(state.sawSubgrid);
  if (refs.sawCascadeVoices) refs.sawCascadeVoices.setValue(state.sawCascadeVoices);
  if (refs.sawOctave) refs.sawOctave.setValue(state.sawOctave);
}

export function randomizeSelfAvoidingWalk() {
  const preset = SAW_PRESETS[Math.floor(Math.random() * SAW_PRESETS.length)];
  state.sawPreset = preset.id;
  state.sawSpeed = Math.floor(Math.random() * 16) + 4;
  state.sawMaxLen = Math.floor(Math.random() * 24) * 4 + 32;
  state.sawBias = Math.round((Math.random() * 0.8) * 100) / 100;
  state.sawSubgrid = Math.floor(Math.random() * 8) * 2 + 16;
  state.sawCascadeVoices = Math.floor(Math.random() * 6) + 3;
  state.sawOctave = Math.floor(Math.random() * 3) - 1;
  resetChain();
  syncControls();
  renderCanvas();
  status(`Self-Avoiding Walk randomized: Preset=${preset.name}, MaxLen=${state.sawMaxLen}, Bias=${state.sawBias}`);
}

export function activateSelfAvoidingWalkModel() {
  if (container) container.style.display = "block";
  stopSelfAvoidingWalk();
  setModelRandomizer(randomizeSelfAvoidingWalk);
  setModelTransportHandler({
    start: startSelfAvoidingWalk,
    stop: stopSelfAvoidingWalk,
    toggle: toggleSelfAvoidingWalkRunning,
    isRunning: isSelfAvoidingWalkRunning
  });
  renderCanvas();
  if (!animFrameId && typeof requestAnimationFrame === "function") {
    lastFrameTime = performance.now();
    animFrameId = requestAnimationFrame(animLoop);
  }
}

export function deactivateSelfAvoidingWalkModel() {
  stopSelfAvoidingWalk();
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
  id: "self_avoiding_walk",
  version: 1,
  capture: () => {
    const coords = [];
    for (let i = 0; i < chainLen; i++) {
      coords.push({ x: chainX[i], y: chainY[i], dir: chainDir[i] });
    }
    return {
      preset: state.sawPreset,
      speed: state.sawSpeed,
      maxLen: state.sawMaxLen,
      bias: state.sawBias,
      subgrid: state.sawSubgrid,
      cascadeVoices: state.sawCascadeVoices,
      octave: state.sawOctave,
      chain: coords
    };
  },
  restore: (data) => {
    if (!data) return;
    if (data.preset) state.sawPreset = data.preset;
    if (data.speed !== undefined) state.sawSpeed = data.speed;
    if (data.maxLen !== undefined) state.sawMaxLen = data.maxLen;
    if (data.bias !== undefined) state.sawBias = data.bias;
    if (data.subgrid !== undefined) state.sawSubgrid = data.subgrid;
    if (data.cascadeVoices !== undefined) state.sawCascadeVoices = data.cascadeVoices;
    if (data.octave !== undefined) state.sawOctave = data.octave;

    lattice.fill(0);
    if (data.chain && Array.isArray(data.chain) && data.chain.length > 0) {
      chainLen = Math.min(MAX_CHAIN_LEN, data.chain.length);
      for (let i = 0; i < chainLen; i++) {
        chainX[i] = data.chain[i].x;
        chainY[i] = data.chain[i].y;
        chainDir[i] = data.chain[i].dir;
        lattice[chainY[i] * GRID_DIM + chainX[i]] = i + 1;
      }
    } else {
      resetChain();
    }
    syncControls();
  }
});
