// js/cellular_bug.js — 2D Cellular + Bug (Turmites / Langton's Ants) Sequencer Model
// 2D Cellular Automata grid (Conway Life / Brian's Brain) traversed by mobile Turmites and Langton's Ants.
// Cluster density & glider collisions trigger scale-quantized staccato note bursts and velocity accents.

import {
  state, refs, status, doGenerate, RATE_NAMES, setModelGenerator,
  setModelRandomizer
} from "./state.js";
import { panicPreview } from "./player.js";
import { knob, dropdown, toggleBtn, actionBtn } from "./controls.js";
import { getRootMidi, getActiveScaleIntervals, quantize, midiName } from "./scale.js";
import { playVoice, releasePolyVoices, selectPolyVoices } from "./poly.js";
import { registerModel } from "./snapshot.js";
import * as audio from "./audio.js";

export const GRID_DIM = 32;
export const TOTAL_CELLS = GRID_DIM * GRID_DIM; // 1024 cells
export const MAX_BUGS = 8;
export const MAX_VOICES = 8;

export const BUG_COLORS = [
  "#00f0ff", // Bug 1: Cyan
  "#ff007f", // Bug 2: Pink
  "#ffb700", // Bug 3: Amber
  "#39ff14", // Bug 4: Lime
  "#a855f7", // Bug 5: Violet
  "#38bdf8", // Bug 6: Sky
  "#f43f5e", // Bug 7: Rose
  "#eab308"  // Bug 8: Gold
];

export const CA_RULES = [
  { id: "conway", name: "Conway's Life (B3/S23)" },
  { id: "brians_brain", name: "Brian's Brain (3-State)" },
  { id: "highlife", name: "HighLife (B36/S23)" },
  { id: "seeds", name: "Seeds (B2/S)" },
  { id: "day_night", name: "Day & Night (B3678/S34678)" }
];

export const BUG_MODES = [
  { id: "langton", name: "Langton's Ant (RL)" },
  { id: "highway", name: "Highway Builder (LLRR)" },
  { id: "spiral", name: "Spiral Turmite (2-State)" },
  { id: "predator", name: "Cluster Forager (Seeker)" },
  { id: "chaotic", name: "Chaotic Wanderer (LRRL)" }
];

export const TRIGGER_MODES = [
  { id: "on_active", name: "On Live Cell (1/2)" },
  { id: "on_turn", name: "On Bug Turn / Deflect" },
  { id: "on_cluster", name: "On Cluster Hit (ρ ≥ 3)" },
  { id: "always", name: "Every Step (Clock)" }
];

export const CELLULAR_BUG_PRESETS = [
  {
    id: "langton_highway",
    name: "Langton Highway",
    desc: "Classic Langton Ants building structured diagonal highways across Life soup",
    caRule: "conway",
    bugMode: "langton",
    triggerMode: "on_active",
    bugs: 4,
    caRate: 2,
    bugSpeed: 1.0,
    mutation: 0.0,
    gate: 0.70,
    density: 0.15
  },
  {
    id: "brian_acid",
    name: "Brian's Acid Brain",
    desc: "Brian's Brain 3-state firing/refractory waves with predatory Turmites",
    caRule: "brians_brain",
    bugMode: "predator",
    triggerMode: "on_cluster",
    bugs: 3,
    caRate: 1,
    bugSpeed: 1.25,
    mutation: 0.02,
    gate: 0.65,
    density: 0.20
  },
  {
    id: "glider_clash",
    name: "Glider Clash",
    desc: "HighLife glider streams colliding with stationary sentinel Turmites",
    caRule: "highlife",
    bugMode: "highway",
    triggerMode: "on_turn",
    bugs: 4,
    caRate: 2,
    bugSpeed: 0.9,
    mutation: 0.01,
    gate: 0.75,
    density: 0.12
  },
  {
    id: "spiral_turmite",
    name: "Spiral Turmite",
    desc: "2-state spiral Turmite expanding structured crystalline arpeggios",
    caRule: "seeds",
    bugMode: "spiral",
    triggerMode: "on_active",
    bugs: 2,
    caRate: 3,
    bugSpeed: 1.1,
    mutation: 0.0,
    gate: 0.80,
    density: 0.08
  },
  {
    id: "chaotic_swarm",
    name: "Chaotic Swarm",
    desc: "High-speed multi-bug swarm foraging across rich Day & Night clusters",
    caRule: "day_night",
    bugMode: "chaotic",
    triggerMode: "always",
    bugs: 6,
    caRate: 1,
    bugSpeed: 1.35,
    mutation: 0.05,
    gate: 0.60,
    density: 0.25
  }
];

// Direction offsets: 0: North, 1: East, 2: South, 3: West
export const DIR_DX = [0, 1, 0, -1];
export const DIR_DY = [-1, 0, 1, 0];

// Pre-allocated typed memory buffers (Zero GC churn)
export const gridState = new Uint8Array(TOTAL_CELLS);
export const nextGrid = new Uint8Array(TOTAL_CELLS);
export const cellPulse = new Float32Array(TOTAL_CELLS);
export const cellVoice = new Int8Array(TOTAL_CELLS).fill(-1);

// Bug coordinates and kinematics (1..8)
export const bugX = new Int16Array(MAX_BUGS);
export const bugY = new Int16Array(MAX_BUGS);
export const bugDir = new Uint8Array(MAX_BUGS);   // 0..3
export const bugState = new Uint8Array(MAX_BUGS); // Internal FSM state
export const bugLastNotes = new Int16Array(MAX_BUGS).fill(-1);
export const bugPulse = new Float32Array(MAX_BUGS);

// Simulation registers
let isSimulationRunning = false;
let animFrameId = null;
let lastTimestamp = 0;
let stepTimer = 0;
let caStepCounter = 0;
export let simStepCounter = 0;

// Canvas & UI elements
let canvasEl = null;
let ctx = null;
let hudElement = null;
let containerEl = null;
let hoverCell = -1;
let isPointerDown = false;
let paintMode = 1; // 1 = draw live cells, 0 = erase

/**
 * Resets grid with random initial soup or clear pattern.
 */
export function initCellularBugGrid(density = 0.15) {
  for (let i = 0; i < TOTAL_CELLS; i++) {
    gridState[i] = Math.random() < density ? 1 : 0;
    nextGrid[i] = gridState[i];
    cellPulse[i] = 0.0;
    cellVoice[i] = -1;
  }

  // Position bugs symmetrically around grid center
  const center = Math.floor(GRID_DIM / 2);
  const radius = 6;
  for (let b = 0; b < MAX_BUGS; b++) {
    const angle = (b / MAX_BUGS) * Math.PI * 2;
    bugX[b] = Math.max(0, Math.min(GRID_DIM - 1, Math.round(center + Math.cos(angle) * radius)));
    bugY[b] = Math.max(0, Math.min(GRID_DIM - 1, Math.round(center + Math.sin(angle) * radius)));
    bugDir[b] = b % 4;
    bugState[b] = 0;
    bugLastNotes[b] = -1;
    bugPulse[b] = 0.0;
  }

  stepTimer = 0;
  caStepCounter = 0;
  simStepCounter = 0;
}

// Initial initialization
initCellularBugGrid(0.15);

/**
 * Computes live neighbor count in Moore neighborhood with toroidal wrap.
 */
export function countNeighbors(x, y) {
  let count = 0;
  for (let dy = -1; dy <= 1; dy++) {
    const ny = (y + dy + GRID_DIM) % GRID_DIM;
    const rowOffset = ny * GRID_DIM;
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      const nx = (x + dx + GRID_DIM) % GRID_DIM;
      if (gridState[rowOffset + nx] === 1) {
        count++;
      }
    }
  }
  return count;
}

/**
 * Advances the 2D Cellular Automaton lattice by 1 generation.
 */
export function stepCellularGrid(rule = "conway") {
  for (let y = 0; y < GRID_DIM; y++) {
    const rowOffset = y * GRID_DIM;
    for (let x = 0; x < GRID_DIM; x++) {
      const idx = rowOffset + x;
      const current = gridState[idx];
      const neighbors = countNeighbors(x, y);

      switch (rule) {
        case "brians_brain":
          // 0 = Ready, 1 = Firing, 2 = Refractory
          if (current === 1) {
            nextGrid[idx] = 2; // Firing -> Refractory
          } else if (current === 2) {
            nextGrid[idx] = 0; // Refractory -> Ready
          } else {
            nextGrid[idx] = (neighbors === 2) ? 1 : 0; // Ready fires if exactly 2 neighbors
          }
          break;

        case "highlife":
          // B36/S23
          if (current === 1) {
            nextGrid[idx] = (neighbors === 2 || neighbors === 3) ? 1 : 0;
          } else {
            nextGrid[idx] = (neighbors === 3 || neighbors === 6) ? 1 : 0;
          }
          break;

        case "seeds":
          // B2/S (all living cells die, 2 neighbors give birth)
          if (current === 1) {
            nextGrid[idx] = 0;
          } else {
            nextGrid[idx] = (neighbors === 2) ? 1 : 0;
          }
          break;

        case "day_night":
          // B3678/S34678
          if (current === 1) {
            nextGrid[idx] = (neighbors === 3 || neighbors === 4 || neighbors === 6 || neighbors === 7 || neighbors === 8) ? 1 : 0;
          } else {
            nextGrid[idx] = (neighbors === 3 || neighbors === 6 || neighbors === 7 || neighbors === 8) ? 1 : 0;
          }
          break;

        case "conway":
        default:
          // B3/S23
          if (current === 1) {
            nextGrid[idx] = (neighbors === 2 || neighbors === 3) ? 1 : 0;
          } else {
            nextGrid[idx] = (neighbors === 3) ? 1 : 0;
          }
          break;
      }
    }
  }

  gridState.set(nextGrid);
}

/**
 * Steps an individual bug / Turmite across the lattice.
 */
export function stepBug(b, bugMode = "langton", mutationRate = 0.0) {
  let x = bugX[b];
  let y = bugY[b];
  let dir = bugDir[b];
  let fsm = bugState[b];
  const cellIdx = y * GRID_DIM + x;
  const currentCell = gridState[cellIdx];
  const oldDir = dir;

  // Evaluate Turmite / Langton rule
  switch (bugMode) {
    case "highway":
      // LLRR rule: 4-color cycling or binary highway builder
      if (currentCell === 0) {
        dir = (dir + 3) % 4; // Turn Left
        gridState[cellIdx] = 1;
      } else {
        dir = (dir + 1) % 4; // Turn Right
        gridState[cellIdx] = 0;
      }
      break;

    case "spiral":
      // 2-State Turmite: state 0 & 1
      if (fsm === 0) {
        if (currentCell === 0) {
          dir = (dir + 1) % 4; // Turn Right
          gridState[cellIdx] = 1;
          fsm = 1;
        } else {
          dir = (dir + 3) % 4; // Turn Left
          gridState[cellIdx] = 0;
        }
      } else {
        if (currentCell === 0) {
          dir = (dir + 3) % 4; // Turn Left
          gridState[cellIdx] = 1;
        } else {
          dir = (dir + 1) % 4; // Turn Right
          gridState[cellIdx] = 0;
          fsm = 0;
        }
      }
      break;

    case "predator": {
      // Seeker: moves toward highest density neighbor
      let bestDensity = -1;
      let bestD = dir;
      for (let d = 0; d < 4; d++) {
        const nx = (x + DIR_DX[d] + GRID_DIM) % GRID_DIM;
        const ny = (y + DIR_DY[d] + GRID_DIM) % GRID_DIM;
        const rho = countNeighbors(nx, ny);
        if (rho > bestDensity) {
          bestDensity = rho;
          bestD = d;
        }
      }
      dir = bestD;
      // Consume active cell into refractory/empty
      if (currentCell === 1) {
        gridState[cellIdx] = 0;
      } else {
        gridState[cellIdx] = 1;
      }
      break;
    }

    case "chaotic":
      // LRRL rule
      if (currentCell === 0) {
        dir = (dir + (fsm === 0 ? 3 : 1)) % 4;
        gridState[cellIdx] = 1;
        fsm ^= 1;
      } else {
        dir = (dir + (fsm === 0 ? 1 : 3)) % 4;
        gridState[cellIdx] = 0;
      }
      break;

    case "langton":
    default:
      // Classic Langton: 0 -> Turn Right, 1 -> Turn Left
      if (currentCell === 0) {
        dir = (dir + 1) % 4; // Turn Right
        gridState[cellIdx] = 1;
      } else {
        dir = (dir + 3) % 4; // Turn Left
        gridState[cellIdx] = 0;
      }
      break;
  }

  // Stochastic mutation (occasional direction flutter)
  if (mutationRate > 0 && Math.random() < mutationRate) {
    dir = (dir + (Math.random() < 0.5 ? 1 : 3)) % 4;
  }

  // Advance position with toroidal wrap
  x = (x + DIR_DX[dir] + GRID_DIM) % GRID_DIM;
  y = (y + DIR_DY[dir] + GRID_DIM) % GRID_DIM;

  bugX[b] = x;
  bugY[b] = y;
  bugDir[b] = dir;
  bugState[b] = fsm;

  const turned = (dir !== oldDir);
  const clusterDensity = countNeighbors(x, y);

  return {
    turned,
    currentCell,
    clusterDensity,
    x,
    y
  };
}

/**
 * Resolves pitch, velocity and trigger status for a bug event.
 */
export function evaluateBugVoice(b, triggerMode, bugRes) {
  const root = getRootMidi();
  const intervals = getActiveScaleIntervals();
  const span = Math.max(1, Math.min(4, state.pitchSpan || 2));

  let shouldTrigger = false;
  switch (triggerMode) {
    case "on_active":
      shouldTrigger = (bugRes.currentCell > 0);
      break;
    case "on_turn":
      shouldTrigger = bugRes.turned;
      break;
    case "on_cluster":
      shouldTrigger = (bugRes.clusterDensity >= 3);
      break;
    case "always":
    default:
      shouldTrigger = true;
      break;
  }

  // Pitch quantization derived from 2D coordinates (polar radius & azimuth)
  const cx = bugRes.x - (GRID_DIM / 2);
  const cy = bugRes.y - (GRID_DIM / 2);
  const radiusNorm = Math.min(1.0, Math.sqrt(cx * cx + cy * cy) / (GRID_DIM * 0.707));
  const rawMidi = root + Math.round(radiusNorm * span * 12);
  const note = quantize(rawMidi, intervals, root);

  // Velocity modulated by local cluster density rho (dense clusters -> heavy accents)
  const baseVel = 45;
  const vel = Math.max(30, Math.min(127, Math.round(baseVel + bugRes.clusterDensity * 10 + (bugRes.currentCell ? 15 : 0))));

  return {
    voice: b,
    shouldTrigger,
    note,
    vel,
    clusterDensity: bugRes.clusterDensity,
    x: bugRes.x,
    y: bugRes.y
  };
}

/**
 * Steps the full Cellular + Bug simulation by one event cycle.
 */
export function stepCellularBug(st = state, isAudioActive = false) {
  const caRule = st.cbugCaRule || "conway";
  const bugMode = st.cbugBugMode || "langton";
  const triggerMode = st.cbugTriggerMode || "on_active";
  const numBugs = Math.max(1, Math.min(MAX_BUGS, st.cbugBugs || 4));
  const caRate = Math.max(1, Number(st.cbugCaRate) || 2);
  const mutationRate = (st.cbugMutation ?? 0) / 100.0;
  const gateMult = (st.cbugGate ?? 70) / 100.0;

  simStepCounter++;
  caStepCounter++;

  // 1. Advance CA grid if at subdivision rate
  if (caStepCounter % caRate === 0) {
    stepCellularGrid(caRule);
  }

  // 2. Step bugs
  const candidates = [];
  for (let b = 0; b < numBugs; b++) {
    const bugRes = stepBug(b, bugMode, mutationRate);
    const vRes = evaluateBugVoice(b, triggerMode, bugRes);
    if (vRes.shouldTrigger) {
      candidates.push(vRes);
    }
  }

  // 3. Polyphony Ceiling: Strictly select up to numBugs (max 8 voices)
  const selected = selectPolyVoices(candidates, numBugs, st.polyStrategy || "extrema");

  if (isAudioActive && selected.length > 0) {
    const durMs = Math.max(50, Math.min(500, Math.round(160 * gateMult)));
    for (const item of selected) {
      playVoice(item.voice, item.note, item.vel, durMs);
      bugLastNotes[item.voice] = item.note;
      bugPulse[item.voice] = 1.0;

      const idx = item.y * GRID_DIM + item.x;
      cellPulse[idx] = 1.0;
      cellVoice[idx] = item.voice;
    }
  }

  return { selected, bugCount: numBugs };
}

/**
 * Real-time simulation integration loop.
 */
export function stepCellularBugSimulation(dt) {
  if (!isSimulationRunning) return;

  const bpm = Number(state.tempo) || 120;
  const speed = Number(state.cbugSpeed) || 1.0;
  const stepInterval = (60.0 / (bpm * 4.0)) / Math.max(0.2, speed);

  stepTimer += dt;
  if (stepTimer >= stepInterval) {
    stepTimer %= stepInterval;
    stepCellularBug(state, true);
  }

  // Smooth visual decay of pulses
  for (let i = 0; i < TOTAL_CELLS; i++) {
    if (cellPulse[i] > 0) {
      cellPulse[i] = Math.max(0.0, cellPulse[i] - dt * 3.5);
    }
  }
  for (let b = 0; b < MAX_BUGS; b++) {
    if (bugPulse[b] > 0) {
      bugPulse[b] = Math.max(0.0, bugPulse[b] - dt * 3.5);
    }
  }
}

/**
 * Generator Function Contract: generateCellularBugBank(state)
 * Deterministically steps the Cellular + Bug engine into a valid 64-step bank array conforming to FM-1 Pulses standard.
 */
export function generateCellularBugBank(st = state) {
  const seqLen = Math.max(1, Math.min(64, st.length || 64));
  const rate = RATE_NAMES[st.rate] || "1/16";

  // Snapshot live simulation memory to temporary buffers
  const tempGrid = new Uint8Array(gridState);
  const tempBugX = new Int16Array(bugX);
  const tempBugY = new Int16Array(bugY);
  const tempBugDir = new Uint8Array(bugDir);
  const tempBugState = new Uint8Array(bugState);
  const tempSimCounter = simStepCounter;
  const tempCaCounter = caStepCounter;

  const steps = [];

  for (let s = 0; s < seqLen; s++) {
    const { selected } = stepCellularBug(st, false);

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

  // Restore live simulation memory
  gridState.set(tempGrid);
  bugX.set(tempBugX);
  bugY.set(tempBugY);
  bugDir.set(tempBugDir);
  bugState.set(tempBugState);
  simStepCounter = tempSimCounter;
  caStepCounter = tempCaCounter;

  return [{
    length: seqLen,
    steps,
    rate
  }];
}

export function isCellularBugRunning() {
  return isSimulationRunning;
}

export function startCellularBug() {
  if (isSimulationRunning) return;
  isSimulationRunning = true;
  lastTimestamp = performance.now();
  status("Cellular + Bug: Running", "ok");
}

export function stopCellularBug() {
  isSimulationRunning = false;
  releasePolyVoices();
  panicPreview();
  status("Cellular + Bug: Stopped", "dim");
}

export function toggleCellularBug() {
  if (isSimulationRunning) {
    stopCellularBug();
  } else {
    startCellularBug();
  }
}

/**
 * Applies a curated preset configuration.
 */
export function applyCellularBugPreset(presetId) {
  const p = CELLULAR_BUG_PRESETS.find((item) => item.id === presetId);
  if (!p) return;

  state.cbugCaRule = p.caRule;
  state.cbugBugMode = p.bugMode;
  state.cbugTriggerMode = p.triggerMode;
  state.cbugBugs = p.bugs;
  state.cbugCaRate = p.caRate;
  state.cbugSpeed = p.bugSpeed;
  state.cbugMutation = Math.round(p.mutation * 100);
  state.cbugGate = Math.round(p.gate * 100);

  initCellularBugGrid(p.density);
  syncControlsFromState();
  doGenerate(true);
  status(`Cellular + Bug: Preset loaded "${p.name}"`, "ok");
}

/**
 * Randomizes the Cellular + Bug parameters and seed soup.
 */
export function randomizeCellularBug() {
  const rules = CA_RULES.map((r) => r.id);
  const bModes = BUG_MODES.map((m) => m.id);
  const tModes = TRIGGER_MODES.map((t) => t.id);

  state.cbugCaRule = rules[Math.floor(Math.random() * rules.length)];
  state.cbugBugMode = bModes[Math.floor(Math.random() * bModes.length)];
  state.cbugTriggerMode = tModes[Math.floor(Math.random() * tModes.length)];
  state.cbugBugs = 2 + Math.floor(Math.random() * 5); // 2 to 6 bugs
  state.cbugCaRate = 1 + Math.floor(Math.random() * 3); // 1 to 3
  state.cbugSpeed = 0.8 + Math.random() * 0.7; // 0.8 to 1.5
  state.cbugMutation = Math.floor(Math.random() * 10); // 0% to 9%

  initCellularBugGrid(0.12 + Math.random() * 0.15);
  syncControlsFromState();
  doGenerate(true);
  status("Cellular + Bug: Randomized", "ok");
}

// Snapshot Serialization
registerModel({
  id: "cellular_bug",
  version: 1,
  migrations: {},
  capture: () => ({
    gridState: Array.from(gridState),
    bugX: Array.from(bugX),
    bugY: Array.from(bugY),
    bugDir: Array.from(bugDir),
    bugState: Array.from(bugState),
    simStepCounter,
    caStepCounter,
    caRule: state.cbugCaRule ?? "conway",
    bugMode: state.cbugBugMode ?? "langton",
    triggerMode: state.cbugTriggerMode ?? "on_active",
    bugs: state.cbugBugs ?? 4,
    caRate: state.cbugCaRate ?? 2,
    speed: state.cbugSpeed ?? 1.0,
    mutation: state.cbugMutation ?? 0,
    gate: state.cbugGate ?? 70
  }),
  restore: (snap) => {
    if (!snap) return;
    if (Array.isArray(snap.gridState) && snap.gridState.length === TOTAL_CELLS) {
      gridState.set(snap.gridState);
    }
    if (Array.isArray(snap.bugX) && snap.bugX.length === MAX_BUGS) {
      bugX.set(snap.bugX);
    }
    if (Array.isArray(snap.bugY) && snap.bugY.length === MAX_BUGS) {
      bugY.set(snap.bugY);
    }
    if (Array.isArray(snap.bugDir) && snap.bugDir.length === MAX_BUGS) {
      bugDir.set(snap.bugDir);
    }
    if (Array.isArray(snap.bugState) && snap.bugState.length === MAX_BUGS) {
      bugState.set(snap.bugState);
    }
    simStepCounter = snap.simStepCounter ?? 0;
    caStepCounter = snap.caStepCounter ?? 0;

    if (snap.caRule !== undefined) state.cbugCaRule = snap.caRule;
    if (snap.bugMode !== undefined) state.cbugBugMode = snap.bugMode;
    if (snap.triggerMode !== undefined) state.cbugTriggerMode = snap.triggerMode;
    if (snap.bugs !== undefined) state.cbugBugs = snap.bugs;
    if (snap.caRate !== undefined) state.cbugCaRate = snap.caRate;
    if (snap.speed !== undefined) state.cbugSpeed = snap.speed;
    if (snap.mutation !== undefined) state.cbugMutation = snap.mutation;
    if (snap.gate !== undefined) state.cbugGate = snap.gate;

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
    stepCellularBugSimulation(dt);
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

  // Resolve dynamic tokens
  const style = getComputedStyle(document.documentElement);
  const colBg = style.getPropertyValue("--panel").trim() || "#18191f";
  const colPanel2 = style.getPropertyValue("--panel2").trim() || "#22252e";
  const colLine = style.getPropertyValue("--line").trim() || "#333846";
  const colLineFocus = style.getPropertyValue("--line-focus").trim() || "#4b5264";
  const colFg = style.getPropertyValue("--fg").trim() || "#f3f4f6";
  const colDim = style.getPropertyValue("--dim").trim() || "#9ca3af";
  const colAccent = style.getPropertyValue("--accent").trim() || "#3b82f6";
  const colAccent2 = style.getPropertyValue("--accent2").trim() || "#60a5fa";

  // Solid background (strictly zero gradients)
  ctx.fillStyle = colBg;
  ctx.fillRect(0, 0, w, h);

  const pad = 12;
  const matrixSize = Math.min(w, h) - pad * 2;
  const cellSize = matrixSize / GRID_DIM;
  const startX = (w - matrixSize) / 2;
  const startY = (h - matrixSize) / 2;

  // 1. Draw Cellular Automata Grid
  for (let y = 0; y < GRID_DIM; y++) {
    const rowOffset = y * GRID_DIM;
    for (let x = 0; x < GRID_DIM; x++) {
      const idx = rowOffset + x;
      const cellVal = gridState[idx];
      const pulse = cellPulse[idx];
      const cx = startX + x * cellSize;
      const cy = startY + y * cellSize;

      if (cellVal === 1) {
        // Active living cell
        ctx.fillStyle = pulse > 0.05 ? colAccent2 : colAccent;
        ctx.fillRect(cx + 0.5, cy + 0.5, cellSize - 1, cellSize - 1);
      } else if (cellVal === 2) {
        // Brian's Brain refractory cell
        ctx.fillStyle = colPanel2;
        ctx.fillRect(cx + 0.5, cy + 0.5, cellSize - 1, cellSize - 1);
        ctx.strokeStyle = colLine;
        ctx.lineWidth = 1;
        ctx.strokeRect(cx + 0.5, cy + 0.5, cellSize - 1, cellSize - 1);
      }

      // Voice pulse overlay
      if (pulse > 0.05) {
        const v = cellVoice[idx];
        const vCol = (v >= 0 && v < MAX_BUGS) ? BUG_COLORS[v] : colFg;
        ctx.fillStyle = vCol;
        ctx.globalAlpha = Math.min(0.7, pulse);
        ctx.fillRect(cx + 0.5, cy + 0.5, cellSize - 1, cellSize - 1);
        ctx.globalAlpha = 1.0;
      }
    }
  }

  // 2. Outer grid border
  ctx.strokeStyle = colLine;
  ctx.lineWidth = 1;
  ctx.strokeRect(startX - 0.5, startY - 0.5, matrixSize + 1, matrixSize + 1);

  // 3. Draw Bugs (Turmites)
  const numBugs = Math.max(1, Math.min(MAX_BUGS, state.cbugBugs || 4));
  for (let b = 0; b < numBugs; b++) {
    const bx = bugX[b];
    const by = bugY[b];
    const bDir = bugDir[b];
    const bugCol = BUG_COLORS[b % BUG_COLORS.length];
    const cx = startX + bx * cellSize + cellSize / 2;
    const cy = startY + by * cellSize + cellSize / 2;
    const bugR = cellSize * 0.95;

    // Draw directional pointer arrow
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(bDir * Math.PI / 2);

    // Flat solid bug arrowhead
    ctx.fillStyle = bugCol;
    ctx.beginPath();
    ctx.moveTo(0, -bugR);
    ctx.lineTo(bugR * 0.8, bugR * 0.7);
    ctx.lineTo(0, bugR * 0.3);
    ctx.lineTo(-bugR * 0.8, bugR * 0.7);
    ctx.closePath();
    ctx.fill();

    // Pulse highlight ring
    if (bugPulse[b] > 0.05) {
      ctx.strokeStyle = colFg;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(0, 0, bugR + bugPulse[b] * 6, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.restore();

    // Bug index badge
    ctx.fillStyle = colFg;
    ctx.font = "bold 8px monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(`${b + 1}`, cx, cy + cellSize + 3);
  }

  // 4. Update HUD status text
  if (hudElement) {
    let liveCells = 0;
    for (let i = 0; i < TOTAL_CELLS; i++) if (gridState[i] > 0) liveCells++;
    hudElement.textContent = `CELLS: ${liveCells}/${TOTAL_CELLS} · BUGS: ${numBugs} · CA STEP: ${caStepCounter} · SIM: ${simStepCounter}`;
  }
}

/**
 * Handles pointer interaction for drawing live cells on the CA canvas.
 */
function handleCanvasPointer(e) {
  if (!canvasEl) return;
  const rect = canvasEl.getBoundingClientRect();
  const scaleX = canvasEl.width / rect.width;
  const scaleY = canvasEl.height / rect.height;
  const mx = (e.clientX - rect.left) * scaleX;
  const my = (e.clientY - rect.top) * scaleY;

  const pad = 12;
  const matrixSize = Math.min(canvasEl.width, canvasEl.height) - pad * 2;
  const cellSize = matrixSize / GRID_DIM;
  const startX = (canvasEl.width - matrixSize) / 2;
  const startY = (canvasEl.height - matrixSize) / 2;

  if (mx < startX || mx >= startX + matrixSize || my < startY || my >= startY + matrixSize) {
    hoverCell = -1;
    return;
  }

  const gx = Math.floor((mx - startX) / cellSize);
  const gy = Math.floor((my - startY) / cellSize);
  const cellIdx = gy * GRID_DIM + gx;
  hoverCell = cellIdx;

  if (isPointerDown) {
    gridState[cellIdx] = paintMode;
    doGenerate(true);
  }
}

// Controller synchronization references
let ctrlPreset = null;
let ctrlCaRule = null;
let ctrlBugMode = null;
let ctrlTriggerMode = null;
let ctrlBugs = null;
let ctrlCaRate = null;
let ctrlSpeed = null;
let ctrlMutation = null;
let ctrlGate = null;
let notesSection = null;

function syncControlsFromState() {
  if (ctrlCaRule) ctrlCaRule.value = state.cbugCaRule ?? "conway";
  if (ctrlBugMode) ctrlBugMode.value = state.cbugBugMode ?? "langton";
  if (ctrlTriggerMode) ctrlTriggerMode.value = state.cbugTriggerMode ?? "on_active";
  if (ctrlBugs) ctrlBugs.value = state.cbugBugs ?? 4;
  if (ctrlCaRate) ctrlCaRate.value = state.cbugCaRate ?? 2;
  if (ctrlSpeed) ctrlSpeed.value = state.cbugSpeed ?? 1.0;
  if (ctrlMutation) ctrlMutation.value = state.cbugMutation ?? 0;
  if (ctrlGate) ctrlGate.value = state.cbugGate ?? 70;
  if (notesSection && typeof notesSection.sync === "function") {
    notesSection.sync();
  }
}

/**
 * Injects classic glider pattern at target coordinate.
 */
export function injectGlider(gx = 5, gy = 5) {
  // Glider pattern:
  // . 1 .
  // . . 1
  // 1 1 1
  const offsets = [
    [1, 0],
    [2, 1],
    [0, 2], [1, 2], [2, 2]
  ];
  for (const [dx, dy] of offsets) {
    const x = (gx + dx + GRID_DIM) % GRID_DIM;
    const y = (gy + dy + GRID_DIM) % GRID_DIM;
    gridState[y * GRID_DIM + x] = 1;
  }
}

/**
 * Initializes DOM elements and controls for the Cellular + Bug model.
 */
export function initCellularBug() {
  const container = document.getElementById("model-cellular_bug");
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

  const btnRun = actionBtn("Run", toggleCellularBug, {
    tip: "Start/Stop autonomous Cellular + Bug simulation",
    accent: true
  });

  hudElement = document.createElement("div");
  hudElement.className = "hud-readout";
  hudElement.style.fontFamily = "monospace";
  hudElement.style.fontSize = "11px";
  hudElement.style.color = "var(--dim)";
  hudElement.textContent = "CELLS: 0/1024 · BUGS: 4 · CA STEP: 0 · SIM: 0";

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
  canvasEl.style.cursor = "crosshair";
  canvasEl.style.display = "block";

  ctx = canvasEl.getContext("2d");

  // Pointer listeners for direct manipulation
  canvasEl.addEventListener("pointerdown", (e) => {
    canvasEl.setPointerCapture(e.pointerId);
    isPointerDown = true;
    paintMode = (e.button === 2 || e.shiftKey) ? 0 : 1;
    handleCanvasPointer(e);
  });
  canvasEl.addEventListener("pointermove", (e) => {
    handleCanvasPointer(e);
  });
  canvasEl.addEventListener("pointerup", (e) => {
    try { canvasEl.releasePointerCapture(e.pointerId); } catch (_) {}
    isPointerDown = false;
  });
  canvasEl.addEventListener("pointerleave", () => {
    isPointerDown = false;
    hoverCell = -1;
  });
  canvasEl.addEventListener("contextmenu", (e) => e.preventDefault());

  visualizerCard.appendChild(canvasEl);

  // Quick Action Buttons
  const actionRow = document.createElement("div");
  actionRow.style.display = "flex";
  actionRow.style.gap = "6px";
  actionRow.style.flexWrap = "wrap";

  actionRow.appendChild(actionBtn("Clear Grid", () => {
    gridState.fill(0);
    doGenerate(true);
  }, { tip: "Clear all cellular automata cells" }));

  actionRow.appendChild(actionBtn("Rand Soup", () => {
    initCellularBugGrid(0.16);
    doGenerate(true);
  }, { tip: "Seed random initial cellular soup" }));

  actionRow.appendChild(actionBtn("Add Glider", () => {
    injectGlider(Math.floor(Math.random() * 26), Math.floor(Math.random() * 26));
    doGenerate(true);
  }, { tip: "Inject a live Conway/HighLife glider into the grid" }));

  actionRow.appendChild(actionBtn("Step CA", () => {
    stepCellularGrid(state.cbugCaRule || "conway");
    doGenerate(true);
  }, { tip: "Manually advance the cellular automaton by 1 generation" }));

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
  ctrlPreset = dropdown(
    "Preset",
    CELLULAR_BUG_PRESETS.map((p) => ({ value: p.id, label: p.name })),
    (val) => applyCellularBugPreset(val),
    { value: "langton_highway", tip: "Curated 2D Cellular + Bug musical regimes" }
  );
  controlsCard.appendChild(ctrlPreset.el);

  // Rules & Automata Settings
  const ruleGrid = document.createElement("div");
  ruleGrid.style.display = "grid";
  ruleGrid.style.gridTemplateColumns = "1fr 1fr";
  ruleGrid.style.gap = "8px";

  ctrlCaRule = dropdown(
    "CA Rule",
    CA_RULES.map((r) => ({ value: r.id, label: r.name })),
    (val) => { state.cbugCaRule = val; doGenerate(true); },
    { value: state.cbugCaRule || "conway", tip: "2D Cellular Automaton evolution rule" }
  );
  ruleGrid.appendChild(ctrlCaRule.el);

  ctrlBugMode = dropdown(
    "Bug Rule",
    BUG_MODES.map((m) => ({ value: m.id, label: m.name })),
    (val) => { state.cbugBugMode = val; doGenerate(true); },
    { value: state.cbugBugMode || "langton", tip: "Turmite / Ant behavioral kinematic rule" }
  );
  ruleGrid.appendChild(ctrlBugMode.el);

  ctrlTriggerMode = dropdown(
    "Trigger",
    TRIGGER_MODES.map((t) => ({ value: t.id, label: t.name })),
    (val) => { state.cbugTriggerMode = val; doGenerate(true); },
    { value: state.cbugTriggerMode || "on_active", tip: "Condition for dispatching scale notes" }
  );
  ruleGrid.appendChild(ctrlTriggerMode.el);

  ctrlBugs = dropdown(
    "Bugs",
    [1, 2, 3, 4, 5, 6, 7, 8].map((n) => ({ value: n, label: `${n} Bug${n > 1 ? "s" : ""}` })),
    (val) => { state.cbugBugs = Number(val); doGenerate(true); },
    { value: state.cbugBugs || 4, tip: "Number of autonomous Turmite voices (1 to 8)" }
  );
  ruleGrid.appendChild(ctrlBugs.el);
  controlsCard.appendChild(ruleGrid);

  // Knobs & Sliders
  const knobRow = document.createElement("div");
  knobRow.style.display = "grid";
  knobRow.style.gridTemplateColumns = "1fr 1fr 1fr 1fr";
  knobRow.style.gap = "8px";

  ctrlCaRate = knob("RATE", 1, 4, 1, state.cbugCaRate || 2, (val) => {
    state.cbugCaRate = Math.round(val);
  }, { tip: "CA grid evolution rate divider (1 = every tick, 4 = every 4th tick)" });
  knobRow.appendChild(ctrlCaRate.el);

  ctrlSpeed = knob("SPD", 0.25, 4.0, 0.05, state.cbugSpeed || 1.0, (val) => {
    state.cbugSpeed = val;
  }, { tip: "Simulation clock speed multiplier" });
  knobRow.appendChild(ctrlSpeed.el);

  ctrlMutation = knob("MUT", 0, 100, 1, state.cbugMutation || 0, (val) => {
    state.cbugMutation = val;
  }, { tip: "Stochastic bug direction flutter / mutation probability (%)" });
  knobRow.appendChild(ctrlMutation.el);

  ctrlGate = knob("GATE", 10, 100, 5, state.cbugGate || 70, (val) => {
    state.cbugGate = val;
  }, { tip: "Note gate duration (% of step interval)" });
  knobRow.appendChild(ctrlGate.el);
  controlsCard.appendChild(knobRow);

  // Scale & Polyphony Notes Section
  import("./scale.js").then(({ createNotesSection }) => {
    notesSection = createNotesSection();
    if (notesSection && notesSection.sectEl) {
      notesSection.sectEl.style.marginTop = "8px";
      controlsCard.appendChild(notesSection.sectEl);
    }
  });

  layout.appendChild(controlsCard);
  container.appendChild(layout);

  syncControlsFromState();
}

/**
 * Activates the model when navigated to.
 */
export function activateCellularBugModel() {
  setModelGenerator(generateCellularBugBank);
  setModelRandomizer(randomizeCellularBug);

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
export function deactivateCellularBugModel() {
  stopCellularBug();
  if (animFrameId) {
    cancelAnimationFrame(animFrameId);
    animFrameId = null;
  }
  setModelGenerator(null);
  setModelRandomizer(null);
}

