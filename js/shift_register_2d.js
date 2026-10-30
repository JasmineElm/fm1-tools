// js/shift_register_2d.js — 2D Shift Register (Toroidal Bit Matrix) Sequencer Model
// Toroidal bit matrix with orthogonal X/Y shift clocks, feedback polynomial taps (Triadex Muse heritage),
// and register cross-sum scale pitch and velocity mapping.

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

export const GRID_SIZE = 8;
export const TOTAL_CELLS = 64; // 8x8 matrix
export const MAX_VOICES = 8;
export const MAX_TAPS = 4;

export const TAP_COLORS = [
  "#ffb700", // T1: Amber
  "#ff007f", // T2: Pink
  "#00f0ff", // T3: Cyan
  "#39ff14"  // T4: Lime
];

export const VOICE_COLORS = [
  "#00f0ff", // Voice 1: Cyan
  "#ff007f", // Voice 2: Pink
  "#ffb700", // Voice 3: Amber
  "#39ff14", // Voice 4: Lime
  "#a855f7", // Voice 5: Violet
  "#38bdf8", // Voice 6: Sky
  "#f43f5e", // Voice 7: Rose
  "#eab308"  // Voice 8: Gold
];

export const CLOCK_RATIOS = [
  { id: "1:1", name: "1:1 (Sync)", xDiv: 1, yDiv: 1 },
  { id: "1:2", name: "1:2 (Half Y)", xDiv: 1, yDiv: 2 },
  { id: "2:1", name: "2:1 (Half X)", xDiv: 2, yDiv: 1 },
  { id: "1:3", name: "1:3 (Triplet Y)", xDiv: 1, yDiv: 3 },
  { id: "3:1", name: "3:1 (Triplet X)", xDiv: 3, yDiv: 1 },
  { id: "2:3", name: "2:3 (Hemiola)", xDiv: 2, yDiv: 3 },
  { id: "3:2", name: "3:2 (Sesquialtera)", xDiv: 3, yDiv: 2 },
  { id: "3:4", name: "3:4 (Polyrhythm)", xDiv: 3, yDiv: 4 },
  { id: "4:3", name: "4:3 (Counter-Poly)", xDiv: 4, yDiv: 3 },
  { id: "1:4", name: "1:4 (Quarter Y)", xDiv: 1, yDiv: 4 }
];

export const SHIFT_DIRS_X = [
  { id: "right", name: "Right (→)" },
  { id: "left", name: "Left (←)" },
  { id: "alternate", name: "Alternate Rows (⇄)" },
  { id: "converge", name: "Converge (→|←)" }
];

export const SHIFT_DIRS_Y = [
  { id: "down", name: "Down (↓)" },
  { id: "up", name: "Up (↑)" },
  { id: "alternate", name: "Alternate Cols (⇅)" },
  { id: "converge", name: "Converge (↓|↑)" }
];

export const FEEDBACK_LOGICS = [
  { id: "xor", name: "XOR (Galois LFSR)" },
  { id: "xnor", name: "XNOR (Inverted LFSR)" },
  { id: "majority", name: "Majority (Voting)" },
  { id: "add_carry", name: "Adder + Carry (Muse)" },
  { id: "rule30", name: "Rule 30 (Wolfram CA)" },
  { id: "rule90", name: "Rule 90 (Sierpinski)" }
];

export const FEEDBACK_TARGETS = [
  { id: "origin", name: "Origin (0,0)" },
  { id: "column_0", name: "Left Column (0,y)" },
  { id: "row_0", name: "Top Row (x,0)" },
  { id: "diagonal", name: "Diagonal (k,k)" },
  { id: "taps", name: "Tap Probe T1" }
];

export const READ_MODES = [
  { id: "row_scan", name: "Row Binary DAC" },
  { id: "cross_sum", name: "Cross-Sum (Row + Col)" },
  { id: "tap_probes", name: "Tap Neighborhoods" },
  { id: "diagonal", name: "Diagonal Slices" }
];

export const TRIGGER_CONDS = [
  { id: "on_one", name: "Bit Active (1 Only)" },
  { id: "always", name: "Always (Every Clock)" },
  { id: "on_transition", name: "Bit Flip (0 → 1)" }
];

export const SEED_PATTERNS = {
  alternating: [
    1, 0, 1, 0, 1, 0, 1, 0,
    0, 1, 0, 1, 0, 1, 0, 1,
    1, 0, 1, 0, 1, 0, 1, 0,
    0, 1, 0, 1, 0, 1, 0, 1,
    1, 0, 1, 0, 1, 0, 1, 0,
    0, 1, 0, 1, 0, 1, 0, 1,
    1, 0, 1, 0, 1, 0, 1, 0,
    0, 1, 0, 1, 0, 1, 0, 1
  ],
  muse: [
    1, 0, 0, 1, 0, 1, 1, 0,
    0, 1, 1, 0, 1, 0, 0, 1,
    1, 1, 0, 0, 0, 1, 1, 0,
    0, 0, 1, 1, 1, 0, 0, 1,
    1, 0, 1, 0, 0, 1, 0, 1,
    0, 1, 0, 1, 1, 0, 1, 0,
    1, 1, 1, 0, 0, 0, 1, 1,
    0, 0, 0, 1, 1, 1, 0, 0
  ],
  cross: [
    1, 0, 0, 0, 0, 0, 0, 1,
    0, 1, 0, 0, 0, 0, 1, 0,
    0, 0, 1, 0, 0, 1, 0, 0,
    0, 0, 0, 1, 1, 0, 0, 0,
    0, 0, 0, 1, 1, 0, 0, 0,
    0, 0, 1, 0, 0, 1, 0, 0,
    0, 1, 0, 0, 0, 0, 1, 0,
    1, 0, 0, 0, 0, 0, 0, 1
  ],
  euclidean: [
    1, 0, 0, 1, 0, 0, 1, 0,
    0, 1, 0, 0, 1, 0, 0, 1,
    1, 0, 1, 0, 0, 1, 0, 0,
    0, 0, 1, 0, 0, 1, 0, 1,
    1, 0, 0, 1, 0, 0, 1, 0,
    0, 1, 0, 0, 1, 0, 0, 1,
    0, 0, 1, 0, 0, 1, 0, 0,
    1, 0, 0, 1, 0, 0, 1, 0
  ],
  fibonacci: [
    1, 1, 0, 1, 0, 0, 1, 0,
    0, 0, 1, 1, 0, 1, 0, 1,
    0, 0, 0, 0, 1, 1, 0, 1,
    0, 1, 0, 0, 0, 0, 1, 1,
    1, 0, 1, 0, 0, 1, 0, 0,
    0, 1, 1, 0, 1, 0, 1, 0,
    1, 1, 0, 0, 1, 0, 0, 1,
    0, 0, 1, 1, 0, 1, 1, 0
  ]
};

export const SR2D_PRESETS = [
  {
    id: "techno_ostinato",
    name: "Techno Ostinato",
    desc: "Hypnotic rolling bassline with alternating row shifts & XOR feedback",
    voices: 2,
    clockRatio: "1:1",
    shiftDirX: "alternate",
    shiftDirY: "down",
    feedbackLogic: "xor",
    feedbackTarget: "origin",
    readMode: "row_scan",
    triggerCond: "on_one",
    mutation: 0.0,
    speed: 1.0,
    gate: 0.70,
    taps: [7, 0, 3, 2, 6, 5, 1, 7],
    seedPattern: "alternating"
  },
  {
    id: "triadex_muse",
    name: "Triadex Muse",
    desc: "Minsky & Fredkin inspired 3:4 polyrhythm with binary adder carry logic",
    voices: 4,
    clockRatio: "3:4",
    shiftDirX: "right",
    shiftDirY: "down",
    feedbackLogic: "add_carry",
    feedbackTarget: "origin",
    readMode: "cross_sum",
    triggerCond: "on_one",
    mutation: 0.02,
    speed: 1.2,
    gate: 0.75,
    taps: [7, 0, 5, 1, 3, 3, 0, 7],
    seedPattern: "muse"
  },
  {
    id: "toroidal_warp",
    name: "Toroidal Warp",
    desc: "Convergent diagonal drift with inverted XNOR feedback & shimmering arpeggios",
    voices: 4,
    clockRatio: "1:2",
    shiftDirX: "converge",
    shiftDirY: "alternate",
    feedbackLogic: "xnor",
    feedbackTarget: "diagonal",
    readMode: "tap_probes",
    triggerCond: "on_transition",
    mutation: 0.05,
    speed: 1.0,
    gate: 0.80,
    taps: [6, 1, 1, 6, 5, 2, 2, 5],
    seedPattern: "cross"
  },
  {
    id: "euclidean_matrix",
    name: "Euclidean Matrix",
    desc: "Symmetrical Euclidean bit distribution with Majority voting logic",
    voices: 4,
    clockRatio: "2:3",
    shiftDirX: "right",
    shiftDirY: "up",
    feedbackLogic: "majority",
    feedbackTarget: "column_0",
    readMode: "cross_sum",
    triggerCond: "on_one",
    mutation: 0.0,
    speed: 1.0,
    gate: 0.65,
    taps: [4, 0, 0, 4, 7, 3, 3, 7],
    seedPattern: "euclidean"
  },
  {
    id: "fibonacci_chaos",
    name: "Fibonacci Chaos",
    desc: "Maximum-period LFSR Galois taps with cellular Rule 90 injection",
    voices: 6,
    clockRatio: "4:3",
    shiftDirX: "left",
    shiftDirY: "down",
    feedbackLogic: "rule90",
    feedbackTarget: "row_0",
    readMode: "row_scan",
    triggerCond: "always",
    mutation: 0.08,
    speed: 1.15,
    gate: 0.60,
    taps: [7, 7, 5, 2, 2, 5, 0, 0],
    seedPattern: "fibonacci"
  }
];

// Pre-allocated typed memory buffers (Zero GC churn)
export const gridBits = new Uint8Array(TOTAL_CELLS);
export const nextBits = new Uint8Array(TOTAL_CELLS);
export const prevBits = new Uint8Array(TOTAL_CELLS);
export const cellPulse = new Float32Array(TOTAL_CELLS);
export const cellVoice = new Int8Array(TOTAL_CELLS).fill(-1);
export const tapCoords = new Int16Array(MAX_TAPS * 2); // [x0, y0, x1, y1, ...]
export const probeCells = new Int16Array(MAX_VOICES * 2); // [x0, y0, x1, y1, ...]
export const voiceLastNotes = new Int16Array(MAX_VOICES).fill(-1);

// State registers
export let carryBit = 0;
export let stepCounter = 0;
let clockAccX = 0;
let clockAccY = 0;
let stepTimer = 0;
let lastTimestamp = 0;
let animFrameId = null;
let isSimulationRunning = false;

// UI & Canvas elements
let canvasEl = null;
let ctx = null;
let hudElement = null;
let sr2dContainer = null;
let draggedTap = -1;
let hoverCell = -1;

/**
 * Initializes the default 2D shift register grid and taps.
 */
export function initShiftRegister2dGrid(patternKey = "alternating") {
  const pat = SEED_PATTERNS[patternKey] || SEED_PATTERNS.alternating;
  for (let i = 0; i < TOTAL_CELLS; i++) {
    gridBits[i] = pat[i % pat.length] ? 1 : 0;
    prevBits[i] = gridBits[i];
    cellPulse[i] = 0.0;
    cellVoice[i] = -1;
  }
  // Default taps: T1(7,0), T2(3,2), T3(6,5), T4(1,7)
  tapCoords[0] = 7; tapCoords[1] = 0;
  tapCoords[2] = 3; tapCoords[3] = 2;
  tapCoords[4] = 6; tapCoords[5] = 5;
  tapCoords[6] = 1; tapCoords[7] = 7;

  carryBit = 0;
  stepCounter = 0;
  clockAccX = 0;
  clockAccY = 0;
  stepTimer = 0;
  voiceLastNotes.fill(-1);
}

// Initial configuration
initShiftRegister2dGrid();

/**
 * Evaluates the feedback logic over the 4 taps.
 */
export function evaluateFeedbackLogic(logicType = "xor") {
  const b0 = gridBits[tapCoords[1] * GRID_SIZE + tapCoords[0]] || 0;
  const b1 = gridBits[tapCoords[3] * GRID_SIZE + tapCoords[2]] || 0;
  const b2 = gridBits[tapCoords[5] * GRID_SIZE + tapCoords[4]] || 0;
  const b3 = gridBits[tapCoords[7] * GRID_SIZE + tapCoords[6]] || 0;

  switch (logicType) {
    case "xnor":
      return 1 - (b0 ^ b1 ^ b2 ^ b3);

    case "majority":
      return (b0 + b1 + b2 + b3 >= 2) ? 1 : 0;

    case "add_carry": {
      const sum = b0 + b1 + carryBit;
      const outBit = sum & 1;
      carryBit = (sum >= 2) ? 1 : 0;
      return outBit;
    }

    case "rule30":
      // Elementary CA Rule 30: b0 ^ (b1 | b2)
      return (b0 ^ (b1 | b2)) & 1;

    case "rule90":
      // Elementary CA Rule 90: b0 ^ b2
      return (b0 ^ b2) & 1;

    case "xor":
    default:
      return (b0 ^ b1 ^ b2 ^ b3) & 1;
  }
}

/**
 * Shifts the 8x8 matrix horizontally and/or vertically.
 */
export function shiftMatrix(shiftX, shiftY, dirX = "right", dirY = "down") {
  // Save current grid to previous grid for transition detection
  for (let i = 0; i < TOTAL_CELLS; i++) {
    prevBits[i] = gridBits[i];
  }

  // Copy gridBits into nextBits
  nextBits.set(gridBits);

  // 1. Horizontal Shift (if shiftX is true)
  if (shiftX) {
    for (let y = 0; y < GRID_SIZE; y++) {
      let dx = 1;
      if (dirX === "left") {
        dx = -1;
      } else if (dirX === "alternate") {
        dx = (y % 2 === 0) ? 1 : -1;
      } else if (dirX === "converge") {
        dx = (y < 4) ? 1 : -1;
      }

      for (let x = 0; x < GRID_SIZE; x++) {
        const srcX = (x - dx + GRID_SIZE) % GRID_SIZE;
        nextBits[y * GRID_SIZE + x] = gridBits[y * GRID_SIZE + srcX];
      }
    }
    gridBits.set(nextBits);
  }

  // 2. Vertical Shift (if shiftY is true)
  if (shiftY) {
    for (let x = 0; x < GRID_SIZE; x++) {
      let dy = 1;
      if (dirY === "up") {
        dy = -1;
      } else if (dirY === "alternate") {
        dy = (x % 2 === 0) ? 1 : -1;
      } else if (dirY === "converge") {
        dy = (x < 4) ? 1 : -1;
      }

      for (let y = 0; y < GRID_SIZE; y++) {
        const srcY = (y - dy + GRID_SIZE) % GRID_SIZE;
        nextBits[y * GRID_SIZE + x] = gridBits[srcY * GRID_SIZE + x];
      }
    }
    gridBits.set(nextBits);
  }
}

/**
 * Injects the feedback bit into the target matrix location.
 */
export function injectFeedback(feedbackBit, target = "origin") {
  switch (target) {
    case "column_0":
      for (let y = 0; y < GRID_SIZE; y++) {
        gridBits[y * GRID_SIZE + 0] = feedbackBit;
      }
      break;

    case "row_0":
      for (let x = 0; x < GRID_SIZE; x++) {
        gridBits[0 * GRID_SIZE + x] = feedbackBit;
      }
      break;

    case "diagonal":
      for (let k = 0; k < GRID_SIZE; k++) {
        gridBits[k * GRID_SIZE + k] = feedbackBit;
      }
      break;

    case "taps": {
      const tx = tapCoords[0];
      const ty = tapCoords[1];
      gridBits[ty * GRID_SIZE + tx] = feedbackBit;
      break;
    }

    case "origin":
    default:
      gridBits[0] = feedbackBit;
      break;
  }
}

/**
 * Applies stochastic bit mutations.
 */
export function applyMutation(rate = 0.0) {
  if (rate <= 0) return;
  if (Math.random() < rate) {
    const idx = Math.floor(Math.random() * TOTAL_CELLS);
    gridBits[idx] ^= 1;
  }
}

/**
 * Resolves pitch, velocity and trigger state for a single voice.
 */
export function evaluateVoice(v, readMode, triggerCond, clockStep) {
  const root = getRootMidi();
  const intervals = getActiveScaleIntervals();
  const span = Math.max(1, Math.min(4, state.pitchSpan || 2));

  let probeX = 0;
  let probeY = 0;
  let norm = 0.0;
  let hammingWeight = 0;

  switch (readMode) {
    case "cross_sum": {
      // Voice v cross-sum: Row v + Column v
      const row = v % GRID_SIZE;
      const col = v % GRID_SIZE;
      let rSum = 0;
      let cSum = 0;
      for (let i = 0; i < GRID_SIZE; i++) {
        rSum += gridBits[row * GRID_SIZE + i];
        cSum += gridBits[i * GRID_SIZE + col];
      }
      hammingWeight = rSum + cSum;
      norm = hammingWeight / 16.0;
      probeX = col;
      probeY = row;
      break;
    }

    case "tap_probes": {
      // Voice v reads neighborhood around tap (v % 4)
      const tIdx = (v % MAX_TAPS) * 2;
      const tx = tapCoords[tIdx];
      const ty = tapCoords[tIdx + 1];
      let sum = gridBits[ty * GRID_SIZE + tx];
      sum += gridBits[ty * GRID_SIZE + ((tx + 1) % GRID_SIZE)];
      sum += gridBits[ty * GRID_SIZE + ((tx + 7) % GRID_SIZE)];
      sum += gridBits[((ty + 1) % GRID_SIZE) * GRID_SIZE + tx];
      sum += gridBits[((ty + 7) % GRID_SIZE) * GRID_SIZE + tx];
      hammingWeight = sum;
      norm = sum / 5.0;
      probeX = tx;
      probeY = ty;
      break;
    }

    case "diagonal": {
      // Voice v reads diagonal slice: (x + y) % 8 === v
      let sum = 0;
      for (let x = 0; x < GRID_SIZE; x++) {
        const y = (8 + v - x) % GRID_SIZE;
        sum += gridBits[y * GRID_SIZE + x];
      }
      hammingWeight = sum;
      norm = sum / 8.0;
      probeX = (v + clockStep) % GRID_SIZE;
      probeY = (8 + v - (clockStep % GRID_SIZE)) % GRID_SIZE;
      break;
    }

    case "row_scan":
    default: {
      // Voice v reads row v as an 8-bit binary value
      const row = v % GRID_SIZE;
      let binVal = 0;
      let hCount = 0;
      for (let x = 0; x < GRID_SIZE; x++) {
        const b = gridBits[row * GRID_SIZE + x];
        if (b) {
          binVal |= (1 << x);
          hCount++;
        }
      }
      hammingWeight = hCount;
      norm = binVal / 255.0;
      probeX = (clockStep + v) % GRID_SIZE;
      probeY = row;
      break;
    }
  }

  // Record probe coordinates for visualization
  probeCells[v * 2] = probeX;
  probeCells[v * 2 + 1] = probeY;

  const currentBit = gridBits[probeY * GRID_SIZE + probeX];
  const previousBit = prevBits[probeY * GRID_SIZE + probeX];

  // Check trigger condition
  let shouldTrigger = true;
  if (triggerCond === "on_one") {
    shouldTrigger = (currentBit === 1);
  } else if (triggerCond === "on_transition") {
    shouldTrigger = (currentBit === 1 && previousBit === 0);
  }

  // Pitch quantization
  const rawMidi = root + Math.round(norm * span * 12);
  const note = quantize(rawMidi, intervals, root);

  // Velocity derived from cross-sum / hamming weight + active bit accent
  const baseVel = 50;
  const vel = Math.max(30, Math.min(127, Math.round(baseVel + hammingWeight * 6 + (currentBit ? 18 : 0))));

  return {
    voice: v,
    probeX,
    probeY,
    currentBit,
    shouldTrigger,
    note,
    vel,
    norm,
    hammingWeight
  };
}

/**
 * Steps the 2D shift register simulation by one clock advance.
 */
export function stepShiftRegister2d(st = state, isAudioActive = false) {
  const clockRatioId = st.sr2dClockRatio || "1:1";
  const ratioDef = CLOCK_RATIOS.find((r) => r.id === clockRatioId) || CLOCK_RATIOS[0];
  const shiftDirX = st.sr2dShiftDirX || "alternate";
  const shiftDirY = st.sr2dShiftDirY || "down";
  const feedbackLogic = st.sr2dFeedbackLogic || "xor";
  const feedbackTarget = st.sr2dFeedbackTarget || "origin";
  const readMode = st.sr2dReadMode || "row_scan";
  const triggerCond = st.sr2dTriggerCond || "on_one";
  const mutationRate = (st.sr2dMutation ?? 0) / 100.0;
  const numVoices = Math.max(1, Math.min(MAX_VOICES, st.sr2dVoices || 4));
  const gateMult = (st.sr2dGate ?? 70) / 100.0;

  stepCounter++;
  clockAccX++;
  clockAccY++;

  const shiftX = (clockAccX % ratioDef.xDiv === 0);
  const shiftY = (clockAccY % ratioDef.yDiv === 0);

  // 1. Shift matrix
  if (shiftX || shiftY) {
    shiftMatrix(shiftX, shiftY, shiftDirX, shiftDirY);

    // 2. Compute feedback and inject
    const fbBit = evaluateFeedbackLogic(feedbackLogic);
    injectFeedback(fbBit, feedbackTarget);

    // 3. Stochastic mutation
    applyMutation(mutationRate);
  }

  // 4. Evaluate voices
  const candidates = [];
  for (let v = 0; v < numVoices; v++) {
    const res = evaluateVoice(v, readMode, triggerCond, stepCounter);
    if (res.shouldTrigger) {
      candidates.push(res);
    }
  }

  // 5. Apply polyphonic voice selection ceiling (<= 8 voices)
  const selected = selectPolyVoices(candidates, numVoices, st.polyStrategy || "extrema");

  if (isAudioActive && selected.length > 0) {
    const durMs = Math.max(50, Math.min(600, Math.round(180 * gateMult)));
    for (const vRes of selected) {
      playVoice(vRes.voice, vRes.note, vRes.vel, durMs);
      voiceLastNotes[vRes.voice] = vRes.note;

      // Visual pulse
      const cellIdx = vRes.probeY * GRID_SIZE + vRes.probeX;
      cellPulse[cellIdx] = 1.0;
      cellVoice[cellIdx] = vRes.voice;
    }
  }

  return { triggeredCount: selected.length, selected };
}

/**
 * Real-time simulation loop.
 */
export function stepShiftRegister2dSimulation(dt) {
  if (!isSimulationRunning) return;

  const bpm = Number(state.tempo) || 120;
  const speed = Number(state.sr2dSpeed) || 1.0;
  // Step duration in seconds: 1/16 note = 60 / (bpm * 4)
  const stepInterval = (60.0 / (bpm * 4.0)) / Math.max(0.2, speed);

  stepTimer += dt;
  if (stepTimer >= stepInterval) {
    stepTimer %= stepInterval;
    stepShiftRegister2d(state, true);
  }

  // Smoothly decay visual pulse
  for (let i = 0; i < TOTAL_CELLS; i++) {
    if (cellPulse[i] > 0) {
      cellPulse[i] = Math.max(0.0, cellPulse[i] - dt * 4.0);
    }
  }
}

/**
 * Generator Function Contract: generateShiftRegister2dBank(state)
 * Deterministically simulates the 2D shift register into a valid 64-step bank array conforming to FM-1 Pulses standard.
 */
export function generateShiftRegister2dBank(st = state) {
  const seqLen = Math.max(1, Math.min(64, st.length || 64));
  const rate = RATE_NAMES[st.rate] || "1/16";
  const numVoices = Math.max(1, Math.min(MAX_VOICES, st.sr2dVoices || 4));

  // Snapshot internal grid to temporary buffers so generation does not corrupt live state
  const tempGrid = new Uint8Array(gridBits);
  const tempPrev = new Uint8Array(prevBits);
  const tempCarry = carryBit;
  const tempCounter = stepCounter;
  const tempAccX = clockAccX;
  const tempAccY = clockAccY;

  const steps = [];

  for (let s = 0; s < seqLen; s++) {
    const { selected } = stepShiftRegister2d(st, false);

    if (selected.length === 0) {
      steps.push({ notes: [] });
    } else {
      const stepNotes = selected.map((vRes) => ({
        note: vRes.note,
        vel: vRes.vel
      }));
      steps.push({ notes: stepNotes });
    }
  }

  // Restore live buffers
  gridBits.set(tempGrid);
  prevBits.set(tempPrev);
  carryBit = tempCarry;
  stepCounter = tempCounter;
  clockAccX = tempAccX;
  clockAccY = tempAccY;

  return [{
    length: seqLen,
    steps,
    rate
  }];
}

export function isShiftRegister2dRunning() {
  return isSimulationRunning;
}

export function startShiftRegister2d() {
  if (isSimulationRunning) return;
  isSimulationRunning = true;
  lastTimestamp = performance.now();
  status("2D Shift Register: Running", "ok");
}

export function stopShiftRegister2d() {
  isSimulationRunning = false;
  releasePolyVoices();
  panicPreview();
  status("2D Shift Register: Stopped", "dim");
}

export function toggleShiftRegister2d() {
  if (isSimulationRunning) {
    stopShiftRegister2d();
  } else {
    startShiftRegister2d();
  }
}

/**
 * Applies a preset configuration.
 */
export function applyShiftRegister2dPreset(presetId) {
  const p = SR2D_PRESETS.find((item) => item.id === presetId);
  if (!p) return;

  state.sr2dVoices = p.voices;
  state.sr2dClockRatio = p.clockRatio;
  state.sr2dShiftDirX = p.shiftDirX;
  state.sr2dShiftDirY = p.shiftDirY;
  state.sr2dFeedbackLogic = p.feedbackLogic;
  state.sr2dFeedbackTarget = p.feedbackTarget;
  state.sr2dReadMode = p.readMode;
  state.sr2dTriggerCond = p.triggerCond;
  state.sr2dMutation = Math.round(p.mutation * 100);
  state.sr2dSpeed = p.speed;
  state.sr2dGate = Math.round(p.gate * 100);

  // Restore taps
  for (let i = 0; i < 8; i++) {
    tapCoords[i] = p.taps[i];
  }

  // Reset grid with seed pattern
  initShiftRegister2dGrid(p.seedPattern);

  syncControlsFromState();
  doGenerate(true);
  status(`2D Shift Register: Preset loaded "${p.name}"`, "ok");
}

/**
 * Randomizes the 2D shift register configuration.
 */
export function randomizeShiftRegister2d() {
  // Randomize grid bits
  for (let i = 0; i < TOTAL_CELLS; i++) {
    gridBits[i] = Math.random() < 0.45 ? 1 : 0;
    prevBits[i] = gridBits[i];
  }

  // Randomize taps ensuring unique cell coordinates
  for (let t = 0; t < MAX_TAPS; t++) {
    tapCoords[t * 2] = Math.floor(Math.random() * GRID_SIZE);
    tapCoords[t * 2 + 1] = Math.floor(Math.random() * GRID_SIZE);
  }

  const ratios = CLOCK_RATIOS.map((r) => r.id);
  const dirsX = SHIFT_DIRS_X.map((d) => d.id);
  const dirsY = SHIFT_DIRS_Y.map((d) => d.id);
  const logics = FEEDBACK_LOGICS.map((l) => l.id);
  const targets = FEEDBACK_TARGETS.map((t) => t.id);
  const readModes = READ_MODES.map((m) => m.id);

  state.sr2dClockRatio = ratios[Math.floor(Math.random() * ratios.length)];
  state.sr2dShiftDirX = dirsX[Math.floor(Math.random() * dirsX.length)];
  state.sr2dShiftDirY = dirsY[Math.floor(Math.random() * dirsY.length)];
  state.sr2dFeedbackLogic = logics[Math.floor(Math.random() * logics.length)];
  state.sr2dFeedbackTarget = targets[Math.floor(Math.random() * targets.length)];
  state.sr2dReadMode = readModes[Math.floor(Math.random() * readModes.length)];
  state.sr2dVoices = 2 + Math.floor(Math.random() * 5); // 2 to 6
  state.sr2dMutation = Math.floor(Math.random() * 15); // 0% to 14%

  syncControlsFromState();
  doGenerate(true);
  status("2D Shift Register: Randomized", "ok");
}

// Snapshot integration
registerModel({
  id: "shift_register_2d",
  version: 1,
  migrations: {},
  capture: () => ({
    gridBits: Array.from(gridBits),
    prevBits: Array.from(prevBits),
    tapCoords: Array.from(tapCoords),
    carryBit,
    stepCounter,
    clockAccX,
    clockAccY,
    voices: state.sr2dVoices ?? 4,
    clockRatio: state.sr2dClockRatio ?? "1:1",
    shiftDirX: state.sr2dShiftDirX ?? "alternate",
    shiftDirY: state.sr2dShiftDirY ?? "down",
    feedbackLogic: state.sr2dFeedbackLogic ?? "xor",
    feedbackTarget: state.sr2dFeedbackTarget ?? "origin",
    readMode: state.sr2dReadMode ?? "row_scan",
    triggerCond: state.sr2dTriggerCond ?? "on_one",
    mutation: state.sr2dMutation ?? 0,
    speed: state.sr2dSpeed ?? 1.0,
    gate: state.sr2dGate ?? 70
  }),
  restore: (snap) => {
    if (!snap) return;
    if (Array.isArray(snap.gridBits) && snap.gridBits.length === TOTAL_CELLS) {
      gridBits.set(snap.gridBits);
    }
    if (Array.isArray(snap.prevBits) && snap.prevBits.length === TOTAL_CELLS) {
      prevBits.set(snap.prevBits);
    }
    if (Array.isArray(snap.tapCoords) && snap.tapCoords.length === MAX_TAPS * 2) {
      tapCoords.set(snap.tapCoords);
    }
    carryBit = snap.carryBit ?? 0;
    stepCounter = snap.stepCounter ?? 0;
    clockAccX = snap.clockAccX ?? 0;
    clockAccY = snap.clockAccY ?? 0;

    if (snap.voices !== undefined) state.sr2dVoices = snap.voices;
    if (snap.clockRatio !== undefined) state.sr2dClockRatio = snap.clockRatio;
    if (snap.shiftDirX !== undefined) state.sr2dShiftDirX = snap.shiftDirX;
    if (snap.shiftDirY !== undefined) state.sr2dShiftDirY = snap.shiftDirY;
    if (snap.feedbackLogic !== undefined) state.sr2dFeedbackLogic = snap.feedbackLogic;
    if (snap.feedbackTarget !== undefined) state.sr2dFeedbackTarget = snap.feedbackTarget;
    if (snap.readMode !== undefined) state.sr2dReadMode = snap.readMode;
    if (snap.triggerCond !== undefined) state.sr2dTriggerCond = snap.triggerCond;
    if (snap.mutation !== undefined) state.sr2dMutation = snap.mutation;
    if (snap.speed !== undefined) state.sr2dSpeed = snap.speed;
    if (snap.gate !== undefined) state.sr2dGate = snap.gate;

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
    stepShiftRegister2dSimulation(dt);
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

  const pad = 28;
  const matrixSize = Math.min(w, h) - pad * 2;
  const cellSize = matrixSize / GRID_SIZE;
  const startX = (w - matrixSize) / 2;
  const startY = (h - matrixSize) / 2;

  // 1. Draw grid cells
  for (let y = 0; y < GRID_SIZE; y++) {
    for (let x = 0; x < GRID_SIZE; x++) {
      const idx = y * GRID_SIZE + x;
      const isOne = (gridBits[idx] === 1);
      const pulse = cellPulse[idx];
      const cx = startX + x * cellSize;
      const cy = startY + y * cellSize;

      // Base fill
      if (isOne) {
        ctx.fillStyle = pulse > 0.05 ? colAccent2 : colAccent;
      } else {
        ctx.fillStyle = colPanel2;
      }
      ctx.fillRect(cx + 1, cy + 1, cellSize - 2, cellSize - 2);

      // Pulse flash overlay if active
      if (pulse > 0.05) {
        const v = cellVoice[idx];
        const vCol = (v >= 0 && v < MAX_VOICES) ? VOICE_COLORS[v] : colFg;
        ctx.fillStyle = vCol;
        ctx.globalAlpha = Math.min(0.6, pulse);
        ctx.fillRect(cx + 1, cy + 1, cellSize - 2, cellSize - 2);
        ctx.globalAlpha = 1.0;
      }

      // Border outline
      ctx.strokeStyle = (hoverCell === idx) ? colLineFocus : colLine;
      ctx.lineWidth = 1;
      ctx.strokeRect(cx + 0.5, cy + 0.5, cellSize - 1, cellSize - 1);

      // Text indicator: 1 or 0
      ctx.fillStyle = isOne ? "#ffffff" : colDim;
      ctx.font = "bold 11px monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(isOne ? "1" : "0", cx + cellSize / 2, cy + cellSize / 2);
    }
  }

  // 2. Draw row & column coordinate guides
  ctx.fillStyle = colDim;
  ctx.font = "9px monospace";
  for (let i = 0; i < GRID_SIZE; i++) {
    // Column headers
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    ctx.fillText(`X${i}`, startX + i * cellSize + cellSize / 2, startY - 6);

    // Row headers
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    ctx.fillText(`Y${i}`, startX - 8, startY + i * cellSize + cellSize / 2);
  }

  // 3. Highlight Voice Probes (Playheads)
  const numVoices = Math.max(1, Math.min(MAX_VOICES, state.sr2dVoices || 4));
  for (let v = 0; v < numVoices; v++) {
    const px = probeCells[v * 2];
    const py = probeCells[v * 2 + 1];
    const cx = startX + px * cellSize;
    const cy = startY + py * cellSize;

    ctx.strokeStyle = VOICE_COLORS[v % VOICE_COLORS.length];
    ctx.lineWidth = 2;
    ctx.strokeRect(cx + 2, cy + 2, cellSize - 4, cellSize - 4);

    // Small voice tag badge at bottom right of probe cell
    ctx.fillStyle = VOICE_COLORS[v % VOICE_COLORS.length];
    ctx.fillRect(cx + cellSize - 10, cy + cellSize - 10, 8, 8);
    ctx.fillStyle = "#111215";
    ctx.font = "bold 7px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(`${v + 1}`, cx + cellSize - 6, cy + cellSize - 6);
  }

  // 4. Draw Feedback Taps (T1 .. T4)
  for (let t = 0; t < MAX_TAPS; t++) {
    const tx = tapCoords[t * 2];
    const ty = tapCoords[t * 2 + 1];
    const cx = startX + tx * cellSize;
    const cy = startY + ty * cellSize;
    const tapColor = TAP_COLORS[t];

    // Tap badge in top left corner of cell
    ctx.fillStyle = tapColor;
    ctx.fillRect(cx + 3, cy + 3, 14, 11);
    ctx.fillStyle = "#111215";
    ctx.font = "bold 8px monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(`T${t + 1}`, cx + 10, cy + 8.5);

    // Outer badge border
    ctx.strokeStyle = (draggedTap === t) ? "#ffffff" : tapColor;
    ctx.lineWidth = (draggedTap === t) ? 2 : 1;
    ctx.strokeRect(cx + 2.5, cy + 2.5, 15, 12);
  }

  // 5. Update HUD status text
  if (hudElement) {
    const fbBit = evaluateFeedbackLogic(state.sr2dFeedbackLogic || "xor");
    const activeVoices = numVoices;
    const activeBits = gridBits.reduce((acc, b) => acc + b, 0);
    hudElement.textContent = `BITS: ${activeBits}/64 · FB: ${fbBit} · CARRY: ${carryBit} · STEP: ${stepCounter}`;
  }
}

/**
 * Handles mouse / direct manipulation on matrix canvas.
 */
function handleCanvasPointer(e, isClick = false) {
  if (!canvasEl) return;
  const rect = canvasEl.getBoundingClientRect();
  const scaleX = canvasEl.width / rect.width;
  const scaleY = canvasEl.height / rect.height;
  const mx = (e.clientX - rect.left) * scaleX;
  const my = (e.clientY - rect.top) * scaleY;

  const pad = 28;
  const matrixSize = Math.min(canvasEl.width, canvasEl.height) - pad * 2;
  const cellSize = matrixSize / GRID_SIZE;
  const startX = (canvasEl.width - matrixSize) / 2;
  const startY = (canvasEl.height - matrixSize) / 2;

  if (mx < startX || mx >= startX + matrixSize || my < startY || my >= startY + matrixSize) {
    hoverCell = -1;
    return;
  }

  const gx = Math.floor((mx - startX) / cellSize);
  const gy = Math.floor((my - startY) / cellSize);
  const cellIdx = gy * GRID_SIZE + gx;
  hoverCell = cellIdx;

  if (isClick) {
    // Check if clicked directly on a tap handle
    for (let t = 0; t < MAX_TAPS; t++) {
      const tx = tapCoords[t * 2];
      const ty = tapCoords[t * 2 + 1];
      if (tx === gx && ty === gy) {
        draggedTap = t;
        return;
      }
    }

    // Toggle bit
    gridBits[cellIdx] ^= 1;
    prevBits[cellIdx] = gridBits[cellIdx];
    doGenerate(true);
  } else if (draggedTap >= 0) {
    // Reposition dragged tap
    tapCoords[draggedTap * 2] = gx;
    tapCoords[draggedTap * 2 + 1] = gy;
    doGenerate(true);
  }
}

// Controller synchronization references
let ctrlPreset = null;
let ctrlVoices = null;
let ctrlClockRatio = null;
let ctrlShiftDirX = null;
let ctrlShiftDirY = null;
let ctrlFeedbackLogic = null;
let ctrlFeedbackTarget = null;
let ctrlReadMode = null;
let ctrlTriggerCond = null;
let ctrlMutation = null;
let ctrlSpeed = null;
let ctrlGate = null;
let notesSection = null;

function syncControlsFromState() {
  if (ctrlVoices) ctrlVoices.value = state.sr2dVoices ?? 4;
  if (ctrlClockRatio) ctrlClockRatio.value = state.sr2dClockRatio ?? "1:1";
  if (ctrlShiftDirX) ctrlShiftDirX.value = state.sr2dShiftDirX ?? "alternate";
  if (ctrlShiftDirY) ctrlShiftDirY.value = state.sr2dShiftDirY ?? "down";
  if (ctrlFeedbackLogic) ctrlFeedbackLogic.value = state.sr2dFeedbackLogic ?? "xor";
  if (ctrlFeedbackTarget) ctrlFeedbackTarget.value = state.sr2dFeedbackTarget ?? "origin";
  if (ctrlReadMode) ctrlReadMode.value = state.sr2dReadMode ?? "row_scan";
  if (ctrlTriggerCond) ctrlTriggerCond.value = state.sr2dTriggerCond ?? "on_one";
  if (ctrlMutation) ctrlMutation.value = state.sr2dMutation ?? 0;
  if (ctrlSpeed) ctrlSpeed.value = state.sr2dSpeed ?? 1.0;
  if (ctrlGate) ctrlGate.value = state.sr2dGate ?? 70;
  if (notesSection && typeof notesSection.sync === "function") {
    notesSection.sync();
  }
}

/**
 * Initializes DOM elements and controls for the 2D Shift Register model.
 */
export function initShiftRegister2d() {
  const container = document.getElementById("model-shift_register_2d");
  if (!container) return;
  sr2dContainer = container;
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

  const btnRun = actionBtn("Run", toggleShiftRegister2d, {
    tip: "Start/Stop autonomous toroidal bit matrix simulation",
    accent: true
  });

  hudElement = document.createElement("div");
  hudElement.className = "hud-readout";
  hudElement.style.fontFamily = "monospace";
  hudElement.style.fontSize = "11px";
  hudElement.style.color = "var(--dim)";
  hudElement.textContent = "BITS: 32/64 · FB: 0 · CARRY: 0 · STEP: 0";

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

  // Canvas direct manipulation pointer listeners
  canvasEl.addEventListener("pointerdown", (e) => {
    canvasEl.setPointerCapture(e.pointerId);
    handleCanvasPointer(e, true);
  });
  canvasEl.addEventListener("pointermove", (e) => {
    handleCanvasPointer(e, false);
  });
  canvasEl.addEventListener("pointerup", (e) => {
    try { canvasEl.releasePointerCapture(e.pointerId); } catch (_) {}
    draggedTap = -1;
  });
  canvasEl.addEventListener("pointerleave", () => {
    hoverCell = -1;
  });

  visualizerCard.appendChild(canvasEl);

  // Quick Action Buttons
  const actionRow = document.createElement("div");
  actionRow.style.display = "flex";
  actionRow.style.gap = "6px";
  actionRow.style.flexWrap = "wrap";

  actionRow.appendChild(actionBtn("Clear", () => {
    gridBits.fill(0);
    prevBits.fill(0);
    doGenerate(true);
  }, { tip: "Clear all matrix bits to 0" }));

  actionRow.appendChild(actionBtn("Invert", () => {
    for (let i = 0; i < TOTAL_CELLS; i++) {
      gridBits[i] ^= 1;
      prevBits[i] = gridBits[i];
    }
    doGenerate(true);
  }, { tip: "Invert all matrix bits (0 ↔ 1)" }));

  actionRow.appendChild(actionBtn("Shift X", () => {
    shiftMatrix(true, false, state.sr2dShiftDirX || "alternate", state.sr2dShiftDirY || "down");
    doGenerate(true);
  }, { tip: "Manually advance horizontal X clock by 1" }));

  actionRow.appendChild(actionBtn("Shift Y", () => {
    shiftMatrix(false, true, state.sr2dShiftDirX || "alternate", state.sr2dShiftDirY || "down");
    doGenerate(true);
  }, { tip: "Manually advance vertical Y clock by 1" }));

  actionRow.appendChild(actionBtn("Rand Bits", () => {
    for (let i = 0; i < TOTAL_CELLS; i++) {
      gridBits[i] = Math.random() < 0.45 ? 1 : 0;
      prevBits[i] = gridBits[i];
    }
    doGenerate(true);
  }, { tip: "Randomize matrix bits" }));

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
    SR2D_PRESETS.map((p) => ({ value: p.id, label: p.name })),
    (val) => applyShiftRegister2dPreset(val),
    { value: "techno_ostinato", tip: "Curated 2D Shift Register musical configurations" }
  );
  controlsCard.appendChild(ctrlPreset.el);

  // Clocks & Direction Section
  const clockGrid = document.createElement("div");
  clockGrid.style.display = "grid";
  clockGrid.style.gridTemplateColumns = "1fr 1fr";
  clockGrid.style.gap = "8px";

  ctrlClockRatio = dropdown(
    "Clock X:Y",
    CLOCK_RATIOS.map((r) => ({ value: r.id, label: r.name })),
    (val) => { state.sr2dClockRatio = val; doGenerate(true); },
    { value: state.sr2dClockRatio || "1:1", tip: "Orthogonal X/Y shift clock ratio" }
  );
  clockGrid.appendChild(ctrlClockRatio.el);

  ctrlVoices = dropdown(
    "Voices",
    [1, 2, 3, 4, 5, 6, 7, 8].map((v) => ({ value: v, label: `${v} Voice${v > 1 ? "s" : ""}` })),
    (val) => { state.sr2dVoices = Number(val); doGenerate(true); },
    { value: state.sr2dVoices || 4, tip: "Simultaneous read probes (up to 8 voices)" }
  );
  clockGrid.appendChild(ctrlVoices.el);

  ctrlShiftDirX = dropdown(
    "Shift X",
    SHIFT_DIRS_X.map((d) => ({ value: d.id, label: d.name })),
    (val) => { state.sr2dShiftDirX = val; doGenerate(true); },
    { value: state.sr2dShiftDirX || "alternate", tip: "Horizontal row shift flow" }
  );
  clockGrid.appendChild(ctrlShiftDirX.el);

  ctrlShiftDirY = dropdown(
    "Shift Y",
    SHIFT_DIRS_Y.map((d) => ({ value: d.id, label: d.name })),
    (val) => { state.sr2dShiftDirY = val; doGenerate(true); },
    { value: state.sr2dShiftDirY || "down", tip: "Vertical column shift flow" }
  );
  clockGrid.appendChild(ctrlShiftDirY.el);
  controlsCard.appendChild(clockGrid);

  // Feedback & Logic Section
  const logicGrid = document.createElement("div");
  logicGrid.style.display = "grid";
  logicGrid.style.gridTemplateColumns = "1fr 1fr";
  logicGrid.style.gap = "8px";

  ctrlFeedbackLogic = dropdown(
    "Feedback",
    FEEDBACK_LOGICS.map((l) => ({ value: l.id, label: l.name })),
    (val) => { state.sr2dFeedbackLogic = val; doGenerate(true); },
    { value: state.sr2dFeedbackLogic || "xor", tip: "Boolean logic polynomial over taps T1..T4" }
  );
  logicGrid.appendChild(ctrlFeedbackLogic.el);

  ctrlFeedbackTarget = dropdown(
    "Inject To",
    FEEDBACK_TARGETS.map((t) => ({ value: t.id, label: t.name })),
    (val) => { state.sr2dFeedbackTarget = val; doGenerate(true); },
    { value: state.sr2dFeedbackTarget || "origin", tip: "Target cells where feedback bit is injected" }
  );
  logicGrid.appendChild(ctrlFeedbackTarget.el);

  ctrlReadMode = dropdown(
    "Read Mode",
    READ_MODES.map((m) => ({ value: m.id, label: m.name })),
    (val) => { state.sr2dReadMode = val; doGenerate(true); },
    { value: state.sr2dReadMode || "row_scan", tip: "How voices convert matrix cells into pitch" }
  );
  logicGrid.appendChild(ctrlReadMode.el);

  ctrlTriggerCond = dropdown(
    "Trigger",
    TRIGGER_CONDS.map((c) => ({ value: c.id, label: c.name })),
    (val) => { state.sr2dTriggerCond = val; doGenerate(true); },
    { value: state.sr2dTriggerCond || "on_one", tip: "Gate trigger condition for voice probes" }
  );
  logicGrid.appendChild(ctrlTriggerCond.el);
  controlsCard.appendChild(logicGrid);

  // Knobs & Sliders
  const knobRow = document.createElement("div");
  knobRow.style.display = "grid";
  knobRow.style.gridTemplateColumns = "1fr 1fr 1fr";
  knobRow.style.gap = "8px";

  ctrlMutation = knob("MUT", 0, 100, 1, state.sr2dMutation || 0, (val) => {
    state.sr2dMutation = val;
  }, { tip: "Stochastic bit mutation probability (%)" });
  knobRow.appendChild(ctrlMutation.el);

  ctrlSpeed = knob("SPD", 0.25, 4.0, 0.05, state.sr2dSpeed || 1.0, (val) => {
    state.sr2dSpeed = val;
  }, { tip: "Clock multiplier speed factor" });
  knobRow.appendChild(ctrlSpeed.el);

  ctrlGate = knob("GATE", 10, 100, 5, state.sr2dGate || 70, (val) => {
    state.sr2dGate = val;
  }, { tip: "Note gate duration (% of step interval)" });
  knobRow.appendChild(ctrlGate.el);
  controlsCard.appendChild(knobRow);

  // Scale & Notes Section
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
export function activateShiftRegister2dModel() {
  setModelGenerator(generateShiftRegister2dBank);
  setModelRandomizer(randomizeShiftRegister2d);

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
export function deactivateShiftRegister2dModel() {
  stopShiftRegister2d();
  if (animFrameId) {
    cancelAnimationFrame(animFrameId);
    animFrameId = null;
  }
  setModelGenerator(null);
  setModelRandomizer(null);
}

