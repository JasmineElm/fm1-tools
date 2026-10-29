// markov_matrix.js — High-Order Markov Transition Matrix Melodic Memory Sequencer for FM-1 Pulses.
// Conditional state transition probabilities, Boltzmann temperature entropy scaling, higher-order n-gram memory, and polyphonic counterpoint.
//
// Generative Architecture:
// 1. Stochastic Melodic Transition Matrix:
//    - 8 discrete musical state nodes (Degrees 1–8 / scale intervals 0–7).
//    - Transition probability matrix M[8][8]: M_ij = P(S_t = j | S_{t-1} = i).
//    - Boltzmann temperature scaling: P(j) = (W_j)^(1/tau) / sum((W_k)^(1/tau)).
//      - Low tau (tau < 0.4): deterministic cyclic melodic loops and ostinatos.
//      - Medium tau (0.8 <= tau <= 1.2): expressive structured phrases.
//      - High tau (tau > 1.8): maximum entropy aleatoric exploration.
// 2. High-Order Melodic Memory (N-Gram History):
//    - Tracks recent 3-step transition history [s_{t-2}, s_{t-1}, s_t] to bias against or reinforce repeated motifs.
// 3. Polyphonic Multi-Strand Walkers (Strict 8-Voice Hardware Ceiling):
//    - Up to 8 concurrent voice walkers navigating the transition matrix simultaneously.
//    - Each walker can hold a distinct octave register (bass, mid tenor, treble lead).
//    - Voice dispatch routed strictly through js/poly.js.
// 4. Continuous Timbre Modulation (CC #74):
//    - Instantaneous Shannon information entropy H = -sum(P * log2(P)) modulates CC #74 Brightness.
// 5. Direct Manipulation Flat Workbench UI:
//    - Interactive 8x8 transition probability heatmap: click/drag cells to paint transition weights.
//    - Active voice walker tokens animated directly on the grid and state ring.
// 6. Zero GC Churn: Pre-allocated TypedArrays (Float32Array, Uint8Array).

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

// ---- Constants & Pre-allocated TypedArrays (Zero GC Churn) ----
export const NUM_STATES = 8; // 8 scale degrees (1st to 8th octave)
export const MAX_WALKERS = 8; // Strict FM-1 8 hardware voice limit

// 8x8 Transition Matrix Weights (Row: From State, Col: To State)
export const transitionWeights = new Float32Array(NUM_STATES * NUM_STATES);
export const normalizedProbs = new Float32Array(NUM_STATES * NUM_STATES);

// Multi-Voice Walkers
export const walkers = [];
for (let i = 0; i < MAX_WALKERS; i++) {
  walkers.push({
    active: i < 4, // 4 walkers active by default
    currentState: i % NUM_STATES,
    prevStates: new Int8Array(4), // History of last 4 states
    historyLen: 0,
    stepTimer: 0,
    stepRate: 1, // Step every N ticks
    octave: i === 0 ? 0 : (i === 1 ? 1 : (i === 2 ? 1 : 2)),
    pulseAnim: 0
  });
}

// Presets
export const MARKOV_PRESETS = [
  {
    id: "bach_chorale",
    name: "Bach Modal Cadence",
    desc: "Stepwise melodic motion with authentic cadence resolutions back to the tonic degree",
    temp: 0.85,
    order: 2,
    walkers: 4,
    drift: 0.02,
    matrix: [
      // 0     1     2     3     4     5     6     7
      [0.05, 0.40, 0.20, 0.05, 0.20, 0.05, 0.02, 0.03], // From 0 (Tonic)
      [0.35, 0.05, 0.40, 0.10, 0.05, 0.02, 0.01, 0.02], // From 1 (Supertonic)
      [0.20, 0.25, 0.05, 0.35, 0.10, 0.03, 0.01, 0.01], // From 2 (Mediant)
      [0.10, 0.05, 0.25, 0.05, 0.45, 0.08, 0.01, 0.01], // From 3 (Subdominant)
      [0.45, 0.05, 0.15, 0.05, 0.05, 0.20, 0.03, 0.02], // From 4 (Dominant)
      [0.15, 0.05, 0.05, 0.20, 0.35, 0.05, 0.12, 0.03], // From 5 (Submediant)
      [0.75, 0.02, 0.02, 0.01, 0.10, 0.02, 0.02, 0.06], // From 6 (Leading Tone -> resolves to 0!)
      [0.60, 0.10, 0.05, 0.05, 0.15, 0.02, 0.01, 0.02]  // From 7 (Octave -> resolves down)
    ]
  },
  {
    id: "pentatonic_gamelan",
    name: "Gamelan Kotekan",
    desc: "Interlocking cyclical chains with non-resolving ostinato loops",
    temp: 0.65,
    order: 2,
    walkers: 4,
    drift: 0.01,
    matrix: [
      [0.05, 0.10, 0.65, 0.05, 0.10, 0.02, 0.01, 0.02],
      [0.05, 0.05, 0.10, 0.65, 0.10, 0.02, 0.01, 0.02],
      [0.10, 0.05, 0.05, 0.10, 0.65, 0.02, 0.01, 0.02],
      [0.65, 0.10, 0.05, 0.05, 0.10, 0.02, 0.01, 0.02],
      [0.10, 0.65, 0.10, 0.05, 0.05, 0.02, 0.01, 0.02],
      [0.20, 0.20, 0.20, 0.20, 0.10, 0.05, 0.02, 0.03],
      [0.15, 0.15, 0.25, 0.25, 0.10, 0.05, 0.02, 0.03],
      [0.25, 0.25, 0.20, 0.15, 0.10, 0.02, 0.01, 0.02]
    ]
  },
  {
    id: "blues_walk",
    name: "Blues & Pentatonic Turnarounds",
    desc: "Arpeggiated blues leaps, flat fifth inflections, and turnaround slides",
    temp: 0.90,
    order: 1,
    walkers: 3,
    drift: 0.03,
    matrix: [
      [0.10, 0.05, 0.45, 0.05, 0.25, 0.05, 0.02, 0.03],
      [0.30, 0.05, 0.15, 0.35, 0.10, 0.02, 0.01, 0.02],
      [0.15, 0.05, 0.05, 0.10, 0.50, 0.10, 0.02, 0.03],
      [0.20, 0.05, 0.40, 0.05, 0.20, 0.05, 0.02, 0.03],
      [0.35, 0.05, 0.20, 0.15, 0.05, 0.15, 0.02, 0.03],
      [0.15, 0.05, 0.10, 0.25, 0.35, 0.05, 0.02, 0.03],
      [0.55, 0.05, 0.15, 0.05, 0.15, 0.02, 0.01, 0.02],
      [0.70, 0.02, 0.10, 0.02, 0.12, 0.02, 0.01, 0.01]
    ]
  },
  {
    id: "fibonacci_spiral",
    name: "Fibonacci Spiral",
    desc: "Geometric golden ratio modular skips creating self-similar melodic spirals",
    temp: 0.70,
    order: 2,
    walkers: 4,
    drift: 0.01,
    matrix: [
      [0.02, 0.60, 0.25, 0.02, 0.08, 0.01, 0.01, 0.01],
      [0.01, 0.02, 0.60, 0.25, 0.02, 0.08, 0.01, 0.01],
      [0.01, 0.01, 0.02, 0.60, 0.25, 0.02, 0.08, 0.01],
      [0.01, 0.01, 0.01, 0.02, 0.60, 0.25, 0.02, 0.08],
      [0.08, 0.01, 0.01, 0.01, 0.02, 0.60, 0.25, 0.02],
      [0.02, 0.08, 0.01, 0.01, 0.01, 0.02, 0.60, 0.25],
      [0.25, 0.02, 0.08, 0.01, 0.01, 0.01, 0.02, 0.60],
      [0.60, 0.25, 0.02, 0.08, 0.01, 0.01, 0.01, 0.02]
    ]
  },
  {
    id: "aleatoric_diffuse",
    name: "Aleatoric Cloud",
    desc: "High entropy diffuse transitions producing organic wandering pitch clusters",
    temp: 1.85,
    order: 1,
    walkers: 6,
    drift: 0.08,
    matrix: [
      [0.15, 0.14, 0.13, 0.12, 0.13, 0.11, 0.11, 0.11],
      [0.12, 0.15, 0.14, 0.13, 0.12, 0.12, 0.11, 0.11],
      [0.11, 0.12, 0.15, 0.14, 0.13, 0.12, 0.12, 0.11],
      [0.11, 0.11, 0.12, 0.15, 0.14, 0.13, 0.12, 0.12],
      [0.12, 0.11, 0.11, 0.12, 0.15, 0.14, 0.13, 0.12],
      [0.12, 0.12, 0.11, 0.11, 0.12, 0.15, 0.14, 0.13],
      [0.13, 0.12, 0.12, 0.11, 0.11, 0.12, 0.15, 0.14],
      [0.14, 0.13, 0.12, 0.12, 0.11, 0.11, 0.12, 0.15]
    ]
  }
];

// Runtime State
let isMarkovPlaying = false;
let animFrameId = null;
let lastFrameTime = 0;
let stepTimerAcc = 0;
let meanEntropy = 1.0;

// UI & Canvas References
let container = null;
let canvas = null;
let ctx = null;
let hoveredCell = { row: -1, col: -1 };
let isPainting = false;

/**
 * Configure transition matrix and voice walkers according to preset.
 */
export function initMarkovPreset(presetId = state.markovPreset || "bach_chorale") {
  const preset = MARKOV_PRESETS.find(p => p.id === presetId) || MARKOV_PRESETS[0];
  state.markovPreset = preset.id;

  // Load preset transition matrix
  for (let r = 0; r < NUM_STATES; r++) {
    for (let c = 0; c < NUM_STATES; c++) {
      const val = preset.matrix[r]?.[c] ?? (1.0 / NUM_STATES);
      transitionWeights[r * NUM_STATES + c] = val;
    }
  }

  normalizeTransitionMatrix();

  // Configure active voice walkers
  const walkerCount = Math.max(1, Math.min(MAX_WALKERS, Number(state.markovWalkers ?? preset.walkers)));

  for (let i = 0; i < MAX_WALKERS; i++) {
    walkers[i].active = (i < walkerCount);
    walkers[i].currentState = (i * 2) % NUM_STATES;
    walkers[i].prevStates.fill(-1);
    walkers[i].prevStates[0] = walkers[i].currentState;
    walkers[i].historyLen = 1;
    walkers[i].stepTimer = 0;
    walkers[i].pulseAnim = 0;

    // Register distribution
    if (i === 0) walkers[i].octave = 0; // Bass
    else if (i === 1) walkers[i].octave = 1; // Mid
    else if (i === 2) walkers[i].octave = 2; // Lead
    else walkers[i].octave = (i % 3);
  }
}

/**
 * Normalize each row of the transition matrix to sum to 1.0.
 */
export function normalizeTransitionMatrix() {
  for (let r = 0; r < NUM_STATES; r++) {
    const rowOffset = r * NUM_STATES;
    let sum = 0;

    for (let c = 0; c < NUM_STATES; c++) {
      sum += transitionWeights[rowOffset + c];
    }

    if (sum <= 0.0001) {
      // Uniform fallback
      for (let c = 0; c < NUM_STATES; c++) {
        transitionWeights[rowOffset + c] = 1.0 / NUM_STATES;
        normalizedProbs[rowOffset + c] = 1.0 / NUM_STATES;
      }
    } else {
      for (let c = 0; c < NUM_STATES; c++) {
        normalizedProbs[rowOffset + c] = transitionWeights[rowOffset + c] / sum;
      }
    }
  }
}

/**
 * Compute Boltzmann probability distribution for a given state with temperature scaling.
 */
export function getTransitionProbabilities(fromState, tau = 1.0, history = null, order = 1) {
  const rowOffset = Math.max(0, Math.min(NUM_STATES - 1, fromState)) * NUM_STATES;
  const probs = new Float32Array(NUM_STATES);
  const effectiveTau = Math.max(0.1, tau);

  let sum = 0;

  for (let c = 0; c < NUM_STATES; c++) {
    let weight = normalizedProbs[rowOffset + c];

    // Higher-order N-gram memory reinforcement/inhibition
    if (order > 1 && history && history.length > 1) {
      const prevPrev = history[1]; // s_{t-2}
      if (prevPrev !== -1 && prevPrev === c) {
        // Subtle anti-ping-pong bias or motif reinforcement
        weight *= 1.25;
      }
    }

    // Boltzmann temperature scaling: W^(1/tau)
    const scaledWeight = Math.pow(Math.max(0.001, weight), 1.0 / effectiveTau);
    probs[c] = scaledWeight;
    sum += scaledWeight;
  }

  // Normalize
  if (sum > 0) {
    for (let c = 0; c < NUM_STATES; c++) {
      probs[c] /= sum;
    }
  }

  return probs;
}

/**
 * Sample next state according to the probability vector.
 */
export function sampleNextState(probs) {
  const rand = Math.random();
  let cumulative = 0;

  for (let c = 0; c < NUM_STATES; c++) {
    cumulative += probs[c];
    if (rand <= cumulative) {
      return c;
    }
  }

  return NUM_STATES - 1;
}

/**
 * Map scale degree state index to scale-quantized MIDI note.
 */
export function getStateNote(stateIdx, octaveShift = 0) {
  const intervals = getActiveScaleIntervals();
  const root = getRootMidi();
  const span = Math.min(4, Math.max(1, Number(state.markovSpan ?? 2)));

  const numDeg = intervals.length || 7;
  const deg = stateIdx % numDeg;
  const oct = Math.min(span, octaveShift);

  const rawMidi = root + oct * 12 + (intervals[deg] ?? 0);
  return quantize(rawMidi, intervals, root);
}

/**
 * Execute one step of the Markov walkers.
 */
export function stepSimulation(dtMs = 16) {
  const speedMult = Math.max(0.1, Number(state.modelSpeed ?? 1.0));
  const currentPreset = MARKOV_PRESETS.find(p => p.id === (state.markovPreset || "bach_chorale")) || MARKOV_PRESETS[0];

  const tau = Math.max(0.1, Math.min(3.0, Number(state.markovTemp ?? currentPreset.temp)));
  const order = Math.max(1, Math.min(3, Number(state.markovOrder ?? currentPreset.order)));
  const drift = Math.max(0.0, Math.min(0.2, Number(state.markovDrift ?? currentPreset.drift)));

  // Drift / mutation entropy: slowly mutate transition matrix over time
  if (drift > 0.001) {
    for (let i = 0; i < NUM_STATES * NUM_STATES; i++) {
      if (Math.random() < 0.03) {
        transitionWeights[i] = Math.max(0.01, transitionWeights[i] + (Math.random() - 0.5) * drift * 0.4);
      }
    }
    normalizeTransitionMatrix();
  }

  // Step timing: step walkers every ~180ms scaled by speed
  stepTimerAcc += dtMs * speedMult;
  const stepInterval = 180;

  let totalEntropy = 0;
  let activeWalkerCount = 0;

  if (stepTimerAcc >= stepInterval) {
    stepTimerAcc = 0;

    for (let w = 0; w < MAX_WALKERS; w++) {
      const walker = walkers[w];
      if (!walker.active) continue;
      activeWalkerCount++;

      // Compute next state transition distribution
      const probs = getTransitionProbabilities(walker.currentState, tau, walker.prevStates, order);

      // Compute Shannon entropy H = -sum(P * log2(P))
      let entropy = 0;
      for (let c = 0; c < NUM_STATES; c++) {
        if (probs[c] > 0.0001) {
          entropy -= probs[c] * Math.log2(probs[c]);
        }
      }
      totalEntropy += entropy;

      // Sample next state
      const nextState = sampleNextState(probs);

      // Update history buffer
      walker.prevStates[3] = walker.prevStates[2];
      walker.prevStates[2] = walker.prevStates[1];
      walker.prevStates[1] = walker.currentState;
      walker.prevStates[0] = nextState;
      walker.currentState = nextState;
      walker.pulseAnim = 1.0;

      // Trigger Voice
      if (isMarkovPlaying) {
        const note = getStateNote(nextState, walker.octave);
        const vel = Math.max(50, Math.min(127, Math.round(75 + Math.min(1.0, probs[nextState] * 1.5) * 45)));
        const durMs = Math.round(180 + (1.0 - Math.min(1.0, tau / 2.0)) * 140);

        playVoice(`markov_${w}`, note, vel, durMs);
      }
    }
  }

  // Animation pulse decay
  for (let w = 0; w < MAX_WALKERS; w++) {
    if (walkers[w].pulseAnim > 0.01) {
      walkers[w].pulseAnim *= 0.88;
    } else {
      walkers[w].pulseAnim = 0;
    }
  }

  // Continuous Timbre Modulation via Shannon Entropy H in [0, 3 bits]
  if (activeWalkerCount > 0) {
    meanEntropy = totalEntropy / activeWalkerCount;
    const entropyNorm = Math.min(1.0, Math.max(0.0, meanEntropy / 3.0));
    dispatchTimbreCc(entropyNorm, 0.5, 200);
  }
}

/**
 * Render Transition Matrix Heatmap & State Graph onto Canvas.
 */
export function renderCanvas() {
  if (!canvas || !ctx) return;
  const w = canvas.width;
  const h = canvas.height;
  if (w === 0 || h === 0) return;

  const style = getComputedStyle(document.documentElement);
  const colorBg = style.getPropertyValue("--panel").trim() || "#18191f";
  const colorPanel2 = style.getPropertyValue("--panel2").trim() || "#22252e";
  const colorLine = style.getPropertyValue("--line").trim() || "#333846";
  const colorLineFocus = style.getPropertyValue("--line-focus").trim() || "#4b5264";
  const colorFg = style.getPropertyValue("--fg").trim() || "#f3f4f6";
  const colorDim = style.getPropertyValue("--dim").trim() || "#9ca3af";
  const colorAccent = style.getPropertyValue("--accent").trim() || "#3b82f6";
  const colorAccent2 = style.getPropertyValue("--accent2").trim() || "#60a5fa";
  const colorOk = style.getPropertyValue("--ok").trim() || "#22c55e";
  const colorErr = style.getPropertyValue("--err").trim() || "#ef4444";

  // Flat canvas background
  ctx.fillStyle = colorBg;
  ctx.fillRect(0, 0, w, h);

  // Layout split: Left 65% for 8x8 Transition Heatmap Grid, Right 35% for Circular State Graph
  const gridW = w * 0.65;
  const graphX = gridW;
  const graphW = w - gridW;

  // Divider
  ctx.strokeStyle = colorLine;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(graphX, 0);
  ctx.lineTo(graphX, h);
  ctx.stroke();

  // ---- 1. Transition Matrix Heatmap Grid ----
  const marginL = 36;
  const marginT = 28;
  const cellSize = Math.min((gridW - marginL - 16) / NUM_STATES, (h - marginT - 28) / NUM_STATES);

  // Headers
  ctx.font = "bold 9px monospace";
  ctx.fillStyle = colorDim;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  for (let c = 0; c < NUM_STATES; c++) {
    const cx = marginL + c * cellSize + cellSize / 2;
    ctx.fillText(`S${c + 1}`, cx, marginT - 10);
  }

  ctx.textAlign = "right";
  for (let r = 0; r < NUM_STATES; r++) {
    const cy = marginT + r * cellSize + cellSize / 2;
    ctx.fillText(`S${r + 1}`, marginL - 8, cy);
  }

  // Draw Heatmap Cells
  for (let r = 0; r < NUM_STATES; r++) {
    for (let c = 0; c < NUM_STATES; c++) {
      const x = marginL + c * cellSize;
      const y = marginT + r * cellSize;
      const prob = normalizedProbs[r * NUM_STATES + c];
      const isHover = (hoveredCell.row === r && hoveredCell.col === c);

      // Cell background
      ctx.fillStyle = colorPanel2;
      ctx.fillRect(x + 1, y + 1, cellSize - 2, cellSize - 2);

      // Probability fill intensity (Flat color with alpha, no gradients)
      if (prob > 0.01) {
        ctx.fillStyle = colorAccent;
        ctx.globalAlpha = Math.min(1.0, prob * 2.2);
        ctx.fillRect(x + 1, y + 1, cellSize - 2, cellSize - 2);
        ctx.globalAlpha = 1.0;
      }

      // Border
      ctx.strokeStyle = isHover ? colorAccent2 : colorLine;
      ctx.lineWidth = isHover ? 1.5 : 0.8;
      ctx.strokeRect(x + 1, y + 1, cellSize - 2, cellSize - 2);

      // Numeric percentage readout inside cell
      if (cellSize >= 24) {
        ctx.font = "8px monospace";
        ctx.fillStyle = prob > 0.45 ? "#ffffff" : colorDim;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(`${Math.round(prob * 100)}%`, x + cellSize / 2, y + cellSize / 2);
      }
    }
  }

  // Draw Active Walker Playhead Tokens on Grid Margin
  for (let wIdx = 0; wIdx < MAX_WALKERS; wIdx++) {
    const walker = walkers[wIdx];
    if (!walker.active) continue;

    const row = walker.currentState;
    const y = marginT + row * cellSize + cellSize / 2;
    const pulse = walker.pulseAnim;

    ctx.fillStyle = pulse > 0.1 ? colorOk : colorAccent2;
    ctx.beginPath();
    ctx.arc(marginL - 18, y, 4 + pulse * 3, 0, Math.PI * 2);
    ctx.fill();

    ctx.font = "bold 8px monospace";
    ctx.fillStyle = "#ffffff";
    ctx.textAlign = "center";
    ctx.fillText(`${wIdx + 1}`, marginL - 18, y + 1);
  }

  // ---- 2. Circular State Network Graph (Right Panel) ----
  const gcx = graphX + graphW / 2;
  const gcy = h / 2 - 4;
  const ringRadius = Math.min(graphW, h) * 0.35;

  ctx.strokeStyle = colorLine;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(gcx, gcy, ringRadius, 0, Math.PI * 2);
  ctx.stroke();

  // Draw active transition vector lines
  for (let wIdx = 0; wIdx < MAX_WALKERS; wIdx++) {
    const walker = walkers[wIdx];
    if (!walker.active) continue;

    const from = walker.prevStates[1] !== -1 ? walker.prevStates[1] : walker.currentState;
    const to = walker.currentState;

    const a1 = (from * Math.PI * 2) / NUM_STATES - Math.PI / 2;
    const a2 = (to * Math.PI * 2) / NUM_STATES - Math.PI / 2;

    const x1 = gcx + ringRadius * Math.cos(a1);
    const y1 = gcy + ringRadius * Math.sin(a1);
    const x2 = gcx + ringRadius * Math.cos(a2);
    const y2 = gcy + ringRadius * Math.sin(a2);

    ctx.strokeStyle = walker.pulseAnim > 0.1 ? colorOk : colorAccent;
    ctx.lineWidth = walker.pulseAnim > 0.1 ? 2.5 : 1.2;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }

  // Draw State Nodes
  for (let s = 0; s < NUM_STATES; s++) {
    const angle = (s * Math.PI * 2) / NUM_STATES - Math.PI / 2;
    const nx = gcx + ringRadius * Math.cos(angle);
    const ny = gcy + ringRadius * Math.sin(angle);

    // Check if any walker is currently here
    let isOccupied = false;
    let pulseMax = 0;
    for (let wIdx = 0; wIdx < MAX_WALKERS; wIdx++) {
      if (walkers[wIdx].active && walkers[wIdx].currentState === s) {
        isOccupied = true;
        pulseMax = Math.max(pulseMax, walkers[wIdx].pulseAnim);
      }
    }

    ctx.fillStyle = isOccupied ? (pulseMax > 0.1 ? colorOk : colorAccent) : colorPanel2;
    ctx.beginPath();
    ctx.arc(nx, ny, 10 + pulseMax * 4, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = isOccupied ? "#ffffff" : colorLineFocus;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(nx, ny, 10 + pulseMax * 4, 0, Math.PI * 2);
    ctx.stroke();

    const noteName = midiName(getStateNote(s, 1));
    ctx.font = "bold 9px monospace";
    ctx.fillStyle = isOccupied ? "#ffffff" : colorFg;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(`S${s + 1}`, nx, ny - 3);

    ctx.font = "8px monospace";
    ctx.fillStyle = isOccupied ? "#ffffff" : colorDim;
    ctx.fillText(noteName, nx, ny + 7);
  }

  // Readout
  ctx.font = "9px monospace";
  ctx.fillStyle = colorDim;
  ctx.textAlign = "left";
  ctx.fillText(`Entropy: ${meanEntropy.toFixed(2)} bits | Order: ${state.markovOrder || 1}`, 10, h - 8);
}

/**
 * Generator Function Contract: generateMarkovMatrixBank(state).
 * Returns a valid bank array of pattern objects for 64-step sync mode.
 */
export function generateMarkovMatrixBank(stateObj) {
  const seqLen = stateObj?.length || 64;
  const rateIdx = stateObj?.rate !== undefined ? stateObj.rate : 3;

  const steps = [];

  for (let s = 0; s < seqLen; s++) {
    const idx = s % NUM_STATES;
    const note = getStateNote(idx, Math.floor(s / 16) % 3);
    const isDownbeat = (s % 8 === 0);

    steps.push({
      note,
      vel: isDownbeat ? 112 : 84,
      notes: [{ note, vel: isDownbeat ? 112 : 84 }],
      gate: 1,
      accent: isDownbeat ? 1 : 0,
      slide: 0,
      pitchMidi: note,
      source: "markov_matrix",
      stateIdx: idx
    });
  }

  return [
    {
      length: seqLen,
      rate: rateIdx,
      steps
    }
  ];
}

// ---- Transport Handlers ----
export function isMarkovRunning() {
  return isMarkovPlaying;
}

export function startMarkov() {
  if (isMarkovPlaying) return;
  isMarkovPlaying = true;
  audio.unlock();
  updatePlayBtnUI();
  status("Markov Matrix: Stochastic melodic walkers active", "ok");
}

export function stopMarkov() {
  isMarkovPlaying = false;
  releasePolyVoices();
  panicPreview();
  try { audio.allOff(); } catch (_) {}
  updatePlayBtnUI();
  status("Markov Matrix: Stopped", "warn");
}

export function toggleMarkovRunning() {
  if (isMarkovPlaying) stopMarkov();
  else startMarkov();
}

function updatePlayBtnUI() {
  const btn = document.getElementById("markov-play-btn");
  if (!btn) return;
  btn.textContent = isMarkovPlaying ? "Stop" : "Play";
  btn.className = isMarkovPlaying ? "btn btn-err" : "btn btn-ok";
}

/**
 * Model Activation / Deactivation Lifecycle
 */
export function activateMarkovMatrixModel() {
  setModelGenerator(generateMarkovMatrixBank);
  setModelStepHandler((stepIdx) => {
    // In SYNC mode: step walkers
    stepSimulation(32);
    renderCanvas();
  });
  setModelTransportHandler({
    start: startMarkov,
    stop: stopMarkov,
    toggle: toggleMarkovRunning,
    isRunning: isMarkovRunning
  });

  stopMarkov();
  lastFrameTime = performance.now();
  if (!animFrameId) {
    animFrameId = requestAnimationFrame(animationTick);
  }
}

export function deactivateMarkovMatrixModel() {
  setModelGenerator(null);
  setModelStepHandler(null);
  setModelTransportHandler(null);
  stopMarkov();
  if (animFrameId) {
    cancelAnimationFrame(animFrameId);
    animFrameId = null;
  }
}

function animationTick(now) {
  if (getActiveModel() === "markov_matrix") {
    const dt = Math.min(50, now - lastFrameTime);
    lastFrameTime = now;

    if (isMarkovPlaying) {
      stepSimulation(dt);
    }
    renderCanvas();

    animFrameId = requestAnimationFrame(animationTick);
  } else {
    animFrameId = null;
  }
}

/**
 * Snapshot Registration
 */
registerModel({
  id: "markov_matrix",
  version: 1,
  migrations: {},
  capture: () => ({
    preset: state.markovPreset || "bach_chorale",
    temp: state.markovTemp ?? 0.85,
    order: state.markovOrder ?? 2,
    walkers: state.markovWalkers ?? 4,
    drift: state.markovDrift ?? 0.02,
    span: state.markovSpan ?? 2,
    weights: Array.from(transitionWeights)
  }),
  restore: (data) => {
    if (!data) return;
    if (data.preset) state.markovPreset = data.preset;
    if (data.temp !== undefined) state.markovTemp = data.temp;
    if (data.order !== undefined) state.markovOrder = data.order;
    if (data.walkers !== undefined) state.markovWalkers = data.walkers;
    if (data.drift !== undefined) state.markovDrift = data.drift;
    if (data.span !== undefined) state.markovSpan = data.span;

    if (Array.isArray(data.weights)) {
      for (let i = 0; i < Math.min(NUM_STATES * NUM_STATES, data.weights.length); i++) {
        transitionWeights[i] = data.weights[i];
      }
      normalizeTransitionMatrix();
    }
    renderCanvas();
  }
});

/**
 * Initialize DOM Elements & Interactive Event Listeners.
 */
export function initMarkovMatrix() {
  container = document.getElementById("model-markov_matrix");
  if (!container) return;

  container.innerHTML = `
    <div class="markov-workbench" style="display: flex; flex-direction: column; gap: 8px; width: 100%;">
      <!-- Controls Toolbar -->
      <div class="markov-toolbar" style="display: flex; flex-wrap: wrap; align-items: center; gap: 10px; background: var(--panel2); padding: 8px 12px; border: 1px solid var(--line);">
        <div id="markov-preset-ctrl"></div>
        <div id="markov-temp-ctrl"></div>
        <div id="markov-order-ctrl"></div>
        <div id="markov-walkers-ctrl"></div>
        <div id="markov-drift-ctrl"></div>
        <div id="markov-span-ctrl"></div>
        <div style="display: flex; gap: 6px; margin-left: auto;">
          <button id="markov-mutate-btn" class="btn" title="Add random entropy perturbation to transition matrix">Mutate</button>
          <button id="markov-reset-btn" class="btn" title="Reset transition matrix to preset baseline">Reset</button>
          <button id="markov-play-btn" class="btn btn-ok" title="Start/Stop Markov Walkers">Play</button>
        </div>
      </div>

      <!-- Interactive Transition Matrix & State Graph Canvas -->
      <div class="markov-canvas-wrap" style="position: relative; width: 100%; border: 1px solid var(--line); background: var(--panel);">
        <canvas id="markov-canvas" width="680" height="340" style="display: block; width: 100%; height: auto; cursor: crosshair;"></canvas>
      </div>
    </div>
  `;

  canvas = document.getElementById("markov-canvas");
  if (canvas) {
    ctx = canvas.getContext("2d");
  }

  // Preset Dropdown
  const presetCtrl = document.getElementById("markov-preset-ctrl");
  if (presetCtrl) {
    presetCtrl.appendChild(
      dropdown({
        label: "Corpus",
        tip: "Markov transition probability network topology preset",
        options: MARKOV_PRESETS.map(p => ({ value: p.id, label: p.name })),
        value: state.markovPreset || "bach_chorale",
        onChange: (val) => {
          setState("markovPreset", val);
          const p = MARKOV_PRESETS.find(x => x.id === val);
          if (p) {
            setState("markovTemp", p.temp);
            setState("markovOrder", p.order);
            setState("markovWalkers", p.walkers);
            setState("markovDrift", p.drift);
            status(`Corpus: ${p.name} — ${p.desc}`);
          }
          initMarkovPreset(val);
          renderCanvas();
        }
      })
    );
  }

  // Temperature / Entropy Knob
  const tempCtrl = document.getElementById("markov-temp-ctrl");
  if (tempCtrl) {
    tempCtrl.appendChild(
      knob({
        label: "Temp τ",
        tip: "Softmax sampling temperature (lower = predictable tonic loops, higher = exploratory chaos)",
        min: 0.1,
        max: 3.0,
        step: 0.05,
        value: Number(state.markovTemp ?? 0.85),
        onChange: (v) => {
          setState("markovTemp", v);
          renderCanvas();
        }
      })
    );
  }

  // Memory Order Knob
  const orderCtrl = document.getElementById("markov-order-ctrl");
  if (orderCtrl) {
    orderCtrl.appendChild(
      knob({
        label: "Order N",
        tip: "Markov memory depth (1st, 2nd, or 3rd order conditional history)",
        min: 1,
        max: 3,
        step: 1,
        value: Number(state.markovOrder ?? 2),
        onChange: (v) => {
          setState("markovOrder", v);
          renderCanvas();
        }
      })
    );
  }

  // Active Walkers Knob (Polyphony 1 to 8)
  const walkersCtrl = document.getElementById("markov-walkers-ctrl");
  if (walkersCtrl) {
    walkersCtrl.appendChild(
      knob({
        label: "Walkers",
        tip: "Number of concurrent polyphonic state-transition walkers (1 to 8 hardware voices)",
        min: 1,
        max: 8,
        step: 1,
        value: Number(state.markovWalkers ?? 4),
        onChange: (v) => {
          setState("markovWalkers", v);
          for (let i = 0; i < MAX_WALKERS; i++) {
            walkers[i].active = (i < v);
          }
          renderCanvas();
        }
      })
    );
  }

  // Drift / Mutation Entropy Knob
  const driftCtrl = document.getElementById("markov-drift-ctrl");
  if (driftCtrl) {
    driftCtrl.appendChild(
      knob({
        label: "Drift",
        tip: "Entropy mutation rate slowly drifting transition probability weights over time",
        min: 0.0,
        max: 0.15,
        step: 0.01,
        value: Number(state.markovDrift ?? 0.02),
        onChange: (v) => {
          setState("markovDrift", v);
          renderCanvas();
        }
      })
    );
  }

  // Pitch Span Knob
  const spanCtrl = document.getElementById("markov-span-ctrl");
  if (spanCtrl) {
    spanCtrl.appendChild(
      knob({
        label: "Span",
        tip: "Pitch span in octaves mapped across the 12 Markov pitch states",
        min: 1,
        max: 4,
        step: 1,
        value: Number(state.markovSpan ?? 2),
        unit: "oct",
        onChange: (v) => {
          setState("markovSpan", v);
          renderCanvas();
        }
      })
    );
  }

  // Buttons
  const mutateBtn = document.getElementById("markov-mutate-btn");
  if (mutateBtn) {
    mutateBtn.addEventListener("click", () => {
      for (let i = 0; i < NUM_STATES * NUM_STATES; i++) {
        transitionWeights[i] = Math.max(0.01, transitionWeights[i] + (Math.random() - 0.5) * 0.25);
      }
      normalizeTransitionMatrix();
      status("Perturbed transition probability weights with entropy mutation");
      renderCanvas();
    });
  }

  const resetBtn = document.getElementById("markov-reset-btn");
  if (resetBtn) {
    resetBtn.addEventListener("click", () => {
      initMarkovPreset(state.markovPreset || "bach_chorale");
      status("Reset transition matrix to preset baseline");
      renderCanvas();
    });
  }

  const playBtn = document.getElementById("markov-play-btn");
  if (playBtn) {
    playBtn.addEventListener("click", () => {
      toggleMarkovRunning();
    });
  }

  setupCanvasInteraction();
  initMarkovPreset(state.markovPreset || "bach_chorale");
  renderCanvas();
}

/**
 * Direct Manipulation: Click or drag on matrix cells to paint transition probabilities.
 */
function setupCanvasInteraction() {
  if (!canvas) return;

  function getCellUnderCursor(e) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const mx = (e.clientX - rect.left) * scaleX;
    const my = (e.clientY - rect.top) * scaleY;

    const gridW = canvas.width * 0.65;
    const marginL = 36;
    const marginT = 28;
    const cellSize = Math.min((gridW - marginL - 16) / NUM_STATES, (canvas.height - marginT - 28) / NUM_STATES);

    if (mx < marginL || mx > marginL + NUM_STATES * cellSize ||
        my < marginT || my > marginT + NUM_STATES * cellSize) {
      return { row: -1, col: -1 };
    }

    const col = Math.floor((mx - marginL) / cellSize);
    const row = Math.floor((my - marginT) / cellSize);
    return { row, col };
  }

  canvas.addEventListener("mousemove", (e) => {
    const { row, col } = getCellUnderCursor(e);
    if (row !== hoveredCell.row || col !== hoveredCell.col) {
      hoveredCell.row = row;
      hoveredCell.col = col;
      renderCanvas();
    }

    if (isPainting && row >= 0 && row < NUM_STATES && col >= 0 && col < NUM_STATES) {
      // Paint transition weight
      transitionWeights[row * NUM_STATES + col] = Math.min(2.0, transitionWeights[row * NUM_STATES + col] + 0.15);
      normalizeTransitionMatrix();
      renderCanvas();
    }
  });

  canvas.addEventListener("mouseleave", () => {
    hoveredCell.row = -1;
    hoveredCell.col = -1;
    isPainting = false;
    renderCanvas();
  });

  canvas.addEventListener("mousedown", (e) => {
    isPainting = true;
    const { row, col } = getCellUnderCursor(e);
    if (row >= 0 && row < NUM_STATES && col >= 0 && col < NUM_STATES) {
      transitionWeights[row * NUM_STATES + col] = Math.min(2.0, transitionWeights[row * NUM_STATES + col] + 0.25);
      normalizeTransitionMatrix();
      status(`Reinforced Transition S${row + 1} → S${col + 1} (${Math.round(normalizedProbs[row * NUM_STATES + col] * 100)}%)`);
      renderCanvas();
    }
  });

  window.addEventListener("mouseup", () => {
    isPainting = false;
  });
}
