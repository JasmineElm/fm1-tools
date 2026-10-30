// fitzhugh_nagumo.js — Biological Neuromorphic Spiking Neural Network Sequencer for FM-1 Pulses.
// Fast excitation / slow recovery electrophysiology ODEs, action potentials, refractory phrasing, and synaptic plasticity.
//
// Generative Architecture:
// 1. Coupled FitzHugh-Nagumo Biophysical Dynamical System:
//    - N biological neurons (up to 8, strictly matching the M-VAVE FM-1 hardware polyphony ceiling).
//    - dv_i/dt = v_i - (v_i^3)/3 - w_i + I_bias[i] * I_scale + sum_j(W_ij * s_j) + I_stim[i] + noise * xi_i
//    - dw_i/dt = epsilon * (v_i + a - b * w_i)
//    - ds_j/dt = -s_j / tau_syn (alpha-synapse conductance decay)
// 2. Action Potential Spikes & Refractory Phrasing:
//    - Depolarization across v >= 1.0 triggers an all-or-nothing action potential.
//    - Post-spike recovery variable w >> 0 enforces an absolute refractory period, preventing voice crowding
//      and generating natural acoustic instrumental breathing.
// 3. Scale Quantization & Pitch Mapping:
//    - Neurons 0–7 mapped to scale-quantized notes across configurable pitch span via js/scale.js.
// 4. Continuous Timbre CC #74 Modulation:
//    - Mean network membrane potential v_mean modulates CC #74 Brightness via dispatchTimbreCc().
// 5. Direct Manipulation Flat Workbench Visualizer:
//    - Interactive neural graph canvas displaying soma nodes, synaptic connections (excitatory vs inhibitory),
//      real-time action potential wave traces, and click-to-stimulate current injection.
// 6. Strict 8-Voice Hardware Ceiling via js/poly.js.
// 7. Zero GC Churn: Pre-allocated TypedArrays (Float32Array, Uint8Array).

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

// ---- Constants & Pre-allocated TypedArrays (Zero GC Churn) ----
export const MAX_NEURONS = 8; // FM-1 Hardware 8-Voice Polyphony Ceiling
export const HISTORY_LEN = 64; // Oscilloscope trace buffer size

export const v = new Float32Array(MAX_NEURONS); // Membrane potentials
export const w = new Float32Array(MAX_NEURONS); // Slow recovery variables
export const prevV = new Float32Array(MAX_NEURONS); // Previous membrane potentials
export const s = new Float32Array(MAX_NEURONS); // Synaptic conductances
export const I_bias = new Float32Array(MAX_NEURONS); // Baseline bias currents
export const I_stim = new Float32Array(MAX_NEURONS); // External user stimulus
export const refractoryTimer = new Float32Array(MAX_NEURONS); // Refractory lockout timer (seconds)
export const spikeAnim = new Float32Array(MAX_NEURONS); // Visual spike flash
export const activeNeuron = new Uint8Array(MAX_NEURONS); // 1 = active, 0 = muted
export const W = new Float32Array(MAX_NEURONS * MAX_NEURONS); // Synaptic weight matrix
export const nodeX = new Float32Array(MAX_NEURONS); // Layout X coords (0 to 1)
export const nodeY = new Float32Array(MAX_NEURONS); // Layout Y coords (0 to 1)

// Multichannel rolling oscilloscope buffer: MAX_NEURONS * HISTORY_LEN
export const traceBuffer = new Float32Array(MAX_NEURONS * HISTORY_LEN);
let traceHead = 0;

// Standard FitzHugh-Nagumo parameters
const PARAM_A = 0.7;
const PARAM_B = 0.8;
const TAU_SYN = 0.06; // Synaptic decay time constant (seconds)

// Presets
export const FHN_PRESETS = [
  {
    id: "synfire",
    name: "Synfire Cascade",
    desc: "Unidirectional cascade (1→2→...→8→1); self-sustaining rhythmic arpeggio loop",
    bias: 0.18,
    weight: 0.65,
    recovery: 0.08,
    noise: 0.02
  },
  {
    id: "cpg",
    name: "Central Pattern Generator",
    desc: "Reciprocal half-center inhibition (N1-4 vs N5-8); alternating walking & breathing rhythms",
    bias: 0.38,
    weight: 0.75,
    recovery: 0.06,
    noise: 0.04
  },
  {
    id: "bursting_hub",
    name: "Pacemaker & Followers",
    desc: "Neuron 1 is a rapid pacemaker driving follower neurons at sub-harmonic ratios",
    bias: 0.25,
    weight: 0.55,
    recovery: 0.09,
    noise: 0.03
  },
  {
    id: "quiescent_resonator",
    name: "Subthreshold Resonators",
    desc: "Quiescent baseline; click or pulse to trigger cascading reverberating spike avalanches",
    bias: 0.14,
    weight: 0.45,
    recovery: 0.08,
    noise: 0.08
  },
  {
    id: "chaotic_recurrent",
    name: "Recurrent Neuropil",
    desc: "Mixed excitatory & inhibitory recurrent matrix; self-organizing aperiodic polyrhythms",
    bias: 0.34,
    weight: 0.85,
    recovery: 0.07,
    noise: 0.12
  },
  {
    id: "random",
    name: "Random Neuropil",
    desc: "Stochastically positioned soma nodes and randomized synaptic wiring matrix",
    bias: 0.28,
    weight: 0.75,
    recovery: 0.08,
    noise: 0.06
  }
];

// Runtime State
let isFhnPlaying = false;
let animFrameId = null;
let lastFrameTime = 0;
let simSubstepAccumulator = 0;
let meanPotential = -1.0;

// UI & Canvas References
let container = null;
let canvas = null;
let ctx = null;
let hoveredNeuron = -1;
let draggedNeuron = -1;

/**
 * Randomize 2D spatial positions of all biological neuron nodes within the graph canvas area.
 * Bounded within [0.12, 0.88] with minimum inter-soma clearance.
 */
export function randomizeNeuronPositions() {
  const minDist = 0.16;
  const positions = [];

  for (let i = 0; i < MAX_NEURONS; i++) {
    let bestX = 0.15 + Math.random() * 0.70;
    let bestY = 0.15 + Math.random() * 0.70;
    let maxDistToOthers = -1;

    for (let attempt = 0; attempt < 30; attempt++) {
      const candX = 0.12 + Math.random() * 0.76;
      const candY = 0.12 + Math.random() * 0.76;

      if (positions.length === 0) {
        bestX = candX;
        bestY = candY;
        break;
      }

      let closest = Infinity;
      for (const p of positions) {
        const d = Math.hypot(p.x - candX, p.y - candY);
        if (d < closest) closest = d;
      }

      if (closest >= minDist) {
        bestX = candX;
        bestY = candY;
        break;
      }

      if (closest > maxDistToOthers) {
        maxDistToOthers = closest;
        bestX = candX;
        bestY = candY;
      }
    }

    nodeX[i] = bestX;
    nodeY[i] = bestY;
    positions.push({ x: nodeX[i], y: nodeY[i] });
  }

  return positions;
}

export function getNeuronPositions() {
  const x = new Float32Array(MAX_NEURONS);
  const y = new Float32Array(MAX_NEURONS);
  for (let i = 0; i < MAX_NEURONS; i++) {
    x[i] = nodeX[i];
    y[i] = nodeY[i];
  }
  return { x, y };
}

/**
 * Configure network topology and baseline excitability according to preset.
 */
export function initNetwork(presetId = state.fhnPreset || "synfire") {
  const preset = FHN_PRESETS.find(p => p.id === presetId) || FHN_PRESETS[0];

  // Clear synaptic matrix
  W.fill(0);
  I_bias.fill(preset.bias);
  I_stim.fill(0);
  refractoryTimer.fill(0);
  spikeAnim.fill(0);
  traceBuffer.fill(-1.0);
  traceHead = 0;

  for (let i = 0; i < MAX_NEURONS; i++) {
    activeNeuron[i] = 1;
    v[i] = -1.1 + (i * 0.05); // Near resting potential
    w[i] = -0.5;
    prevV[i] = v[i];
    s[i] = 0;
  }

  // Topology setups
  if (preset.id === "synfire") {
    // Circular ring layout
    for (let i = 0; i < MAX_NEURONS; i++) {
      const angle = (i * Math.PI * 2) / MAX_NEURONS - Math.PI / 2;
      nodeX[i] = 0.5 + 0.36 * Math.cos(angle);
      nodeY[i] = 0.48 + 0.36 * Math.sin(angle);

      // Unidirectional forward excitatory connection: i -> (i + 1) % MAX_NEURONS
      const next = (i + 1) % MAX_NEURONS;
      W[i * MAX_NEURONS + next] = 0.7;
    }
    // Neuron 0 starts with slightly higher bias or initial stimulus to kickstart cascade
    I_bias[0] = 0.35;
    v[0] = 1.2;
  } else if (preset.id === "cpg") {
    // 2-column Half-Center CPG Layout: Left group (0..3) vs Right group (4..7)
    for (let i = 0; i < 4; i++) {
      nodeX[i] = 0.28;
      nodeY[i] = 0.22 + i * 0.17;
      // Intra-group excitation
      for (let j = 0; j < 4; j++) {
        if (i !== j) W[i * MAX_NEURONS + j] = 0.25;
      }
      // Inter-group mutual inhibition to 4..7
      for (let j = 4; j < 8; j++) {
        W[i * MAX_NEURONS + j] = -0.65;
      }
    }
    for (let i = 4; i < 8; i++) {
      nodeX[i] = 0.72;
      nodeY[i] = 0.22 + (i - 4) * 0.17;
      // Intra-group excitation
      for (let j = 4; j < 8; j++) {
        if (i !== j) W[i * MAX_NEURONS + j] = 0.25;
      }
      // Inter-group mutual inhibition to 0..3
      for (let j = 0; j < 4; j++) {
        W[i * MAX_NEURONS + j] = -0.65;
      }
    }
    v[0] = 1.2; // Start Group A first
    v[4] = -1.2; // Group B hyperpolarized
  } else if (preset.id === "bursting_hub") {
    // Center master hub (Neuron 0) with peripheral followers (1..7)
    nodeX[0] = 0.5;
    nodeY[0] = 0.48;
    I_bias[0] = 0.55; // Master pacemaker

    for (let i = 1; i < MAX_NEURONS; i++) {
      const angle = ((i - 1) * Math.PI * 2) / (MAX_NEURONS - 1) - Math.PI / 2;
      nodeX[i] = 0.5 + 0.38 * Math.cos(angle);
      nodeY[i] = 0.48 + 0.38 * Math.sin(angle);
      I_bias[i] = 0.12;

      // Pacemaker hub drives all followers with staggered weights
      W[0 * MAX_NEURONS + i] = 0.45 + (i % 3) * 0.15;
      // Small lateral connections between neighboring followers
      const nextFollower = 1 + (i % (MAX_NEURONS - 1));
      W[i * MAX_NEURONS + nextFollower] = 0.2;
    }
  } else if (preset.id === "quiescent_resonator") {
    // Star cluster layout
    for (let i = 0; i < MAX_NEURONS; i++) {
      const angle = (i * Math.PI * 2) / MAX_NEURONS;
      const r = i % 2 === 0 ? 0.38 : 0.22;
      nodeX[i] = 0.5 + r * Math.cos(angle);
      nodeY[i] = 0.48 + r * Math.sin(angle);
      I_bias[i] = 0.14; // Strictly subthreshold

      // Recurrent excitatory network
      for (let j = 0; j < MAX_NEURONS; j++) {
        if (i !== j && (Math.abs(i - j) === 1 || Math.abs(i - j) === 3)) {
          W[i * MAX_NEURONS + j] = 0.45;
        }
      }
    }
  } else if (preset.id === "random") {
    randomizeNeuronPositions();
    for (let i = 0; i < MAX_NEURONS; i++) {
      I_bias[i] = 0.20 + Math.random() * 0.25;
      for (let j = 0; j < MAX_NEURONS; j++) {
        if (i === j) continue;
        if (Math.random() < 0.45) {
          W[i * MAX_NEURONS + j] = Math.random() > 0.35
            ? Number((0.25 + Math.random() * 0.55).toFixed(2))
            : Number((-0.20 - Math.random() * 0.45).toFixed(2));
        }
      }
    }
  } else {
    // chaotic_recurrent: Random Neuropil
    for (let i = 0; i < MAX_NEURONS; i++) {
      const angle = (i * Math.PI * 2) / MAX_NEURONS;
      nodeX[i] = 0.5 + 0.35 * Math.cos(angle);
      nodeY[i] = 0.48 + 0.35 * Math.sin(angle);
      I_bias[i] = 0.32;

      for (let j = 0; j < MAX_NEURONS; j++) {
        if (i === j) continue;
        const rand = (Math.sin(i * 13 + j * 37) * 43758.5453) % 1;
        if (rand > 0.4) {
          // 65% excitatory, 35% inhibitory
          W[i * MAX_NEURONS + j] = rand > 0.65 ? 0.55 : -0.45;
        }
      }
    }
  }
}

/**
 * Scale-quantized pitch mapping for neuron index.
 */
export function getNeuronNote(idx) {
  const intervals = getActiveScaleIntervals();
  const root = getRootMidi();
  const span = Math.min(4, Math.max(1, Number(state.pitchSpan ?? state.fhnSpan ?? 2)));

  const numDeg = intervals.length || 7;
  const deg = idx % numDeg;
  const oct = Math.min(span, Math.floor((idx / MAX_NEURONS) * (span + 1)));

  const rawMidi = root + oct * 12 + (intervals[deg] ?? 0);
  return quantize(rawMidi, intervals, root);
}

/**
 * Execute one numerical integration step of the FitzHugh-Nagumo neural network.
 */
export function stepSimulation(dtMs = 16) {
  const speedMult = Math.max(0.1, Number(state.modelSpeed ?? 1.0));
  const effectiveDtSec = (dtMs / 1000) * speedMult;

  const currentPreset = FHN_PRESETS.find(p => p.id === (state.fhnPreset || "synfire")) || FHN_PRESETS[0];
  const stimulusScale = Math.max(0.0, Math.min(2.0, Number(state.fhnStimulus ?? 1.0)));
  const weightScale = Math.max(0.0, Math.min(3.0, Number(state.fhnWeight ?? 1.0)));
  const eps = Math.max(0.01, Math.min(0.25, Number(state.fhnRecovery ?? currentPreset.recovery)));
  const noiseAmt = Math.max(0.0, Math.min(0.5, Number(state.fhnNoise ?? currentPreset.noise)));

  // Substepping: perform 4 sub-steps per frame for high numerical stability (Euler / RK integration)
  const substeps = 4;
  const dt = (effectiveDtSec / substeps) * 3.2;

  let sumV = 0;

  for (let step = 0; step < substeps; step++) {
    for (let i = 0; i < MAX_NEURONS; i++) {
      if (!activeNeuron[i]) continue;

      prevV[i] = v[i];

      // 1. Synaptic current input: sum_j (W_ij * s_j)
      let synCurrent = 0;
      for (let j = 0; j < MAX_NEURONS; j++) {
        if (i !== j && activeNeuron[j]) {
          synCurrent += W[j * MAX_NEURONS + i] * s[j];
        }
      }

      // 2. Injected stimulus and stochastic membrane noise
      const biasVal = I_bias[i] * stimulusScale;
      const stimVal = I_stim[i];
      const noiseVal = noiseAmt * (Math.random() - 0.5) * 1.5;
      const totalI = biasVal + (synCurrent * weightScale) + stimVal + noiseVal;

      // 3. FitzHugh-Nagumo fast membrane voltage ODE: dv/dt = v - (v^3)/3 - w + I
      const dv = (v[i] - (v[i] * v[i] * v[i]) / 3.0 - w[i] + totalI) * dt;

      // 4. Slow potassium gate recovery ODE: dw/dt = eps * (v + a - b * w)
      const dw = eps * (v[i] + PARAM_A - PARAM_B * w[i]) * dt;

      // 5. Synaptic activation decay ODE: ds/dt = -s / tau_syn
      const ds = (-s[i] / TAU_SYN) * dt;

      v[i] = Math.max(-2.5, Math.min(2.5, v[i] + dv));
      w[i] = Math.max(-1.8, Math.min(2.5, w[i] + dw));
      s[i] = Math.max(0.0, Math.min(1.0, s[i] + ds));

      // Decay refractory countdown timer
      if (refractoryTimer[i] > 0) {
        refractoryTimer[i] -= dt;
      }

      // 6. Action potential spike detection:
      // Voltage crosses threshold V_thresh = 1.0 from below, while not in absolute refractory lockout
      const isSpike = (prevV[i] < 1.0 && v[i] >= 1.0 && refractoryTimer[i] <= 0);

      if (isSpike) {
        // Activate synaptic conductance into connected post-synaptic neurons
        s[i] = 1.0;
        // Lock refractory period (natural acoustic instrumental phrasing & anti-crowding)
        refractoryTimer[i] = 0.22 / Math.max(0.5, speedMult);
        spikeAnim[i] = 1.0;

        if (isFhnPlaying) {
          const note = getNeuronNote(i);
          // Velocity modulated by depolarization peak
          const vel = Math.max(50, Math.min(127, Math.round(75 + Math.min(1.0, v[i] / 1.8) * 45)));
          const durMs = Math.round(180 + (1.0 - Math.min(1.0, eps / 0.2)) * 180);

          // Dispatch voice strictly through poly.js manager (slot i, 0 to 7)
          playVoice(`fhn_${i}`, note, vel, durMs);
        }
      }
    }
  }

  // Animation pulse decay, stimulus decay, & average potential calculation
  for (let i = 0; i < MAX_NEURONS; i++) {
    if (I_stim[i] > 0.01) {
      I_stim[i] *= 0.82;
    } else {
      I_stim[i] = 0;
    }

    if (spikeAnim[i] > 0.01) {
      spikeAnim[i] *= 0.86;
    } else {
      spikeAnim[i] = 0;
    }
    sumV += v[i];

    // Store in multichannel oscilloscope trace buffer
    traceBuffer[i * HISTORY_LEN + traceHead] = v[i];
  }

  traceHead = (traceHead + 1) % HISTORY_LEN;
  meanPotential = sumV / MAX_NEURONS;
}

/**
 * Inject an external stimulus current pulse into a specified neuron.
 */
export function injectStimulus(neuronIdx = 0, magnitude = 2.0) {
  if (neuronIdx >= 0 && neuronIdx < MAX_NEURONS) {
    I_stim[neuronIdx] = magnitude;
    v[neuronIdx] = Math.max(v[neuronIdx], 1.2);
    refractoryTimer[neuronIdx] = 0; // Reset refractory to permit immediate trigger
  }
}

/**
 * Reset all membrane potentials to baseline resting state.
 */
export function resetMembranes() {
  for (let i = 0; i < MAX_NEURONS; i++) {
    v[i] = -1.1;
    w[i] = -0.5;
    prevV[i] = -1.1;
    s[i] = 0;
    I_stim[i] = 0;
    refractoryTimer[i] = 0;
    spikeAnim[i] = 0;
  }
  traceBuffer.fill(-1.1);
}

/**
 * Render Neural Graph Workbench Canvas & Real-time Voltage Traces.
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

  // Layout split: Left 68% for Neural Graph, Right 32% for Multichannel Voltage Scope
  const graphW = w * 0.68;
  const scopeX = graphW;
  const scopeW = w - graphW;

  // Divider line
  ctx.strokeStyle = colorLine;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(scopeX, 0);
  ctx.lineTo(scopeX, h);
  ctx.stroke();

  // ---- 1. Synaptic Connections ----
  for (let i = 0; i < MAX_NEURONS; i++) {
    const x1 = nodeX[i] * graphW;
    const y1 = nodeY[i] * h;

    for (let j = 0; j < MAX_NEURONS; j++) {
      if (i === j) continue;
      const weight = W[i * MAX_NEURONS + j];
      if (Math.abs(weight) < 0.05) continue;

      const x2 = nodeX[j] * graphW;
      const y2 = nodeY[j] * h;

      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);

      const isExcitatory = weight > 0;
      ctx.strokeStyle = isExcitatory ? colorAccent : colorErr;
      ctx.lineWidth = Math.min(3.5, Math.max(1.0, Math.abs(weight) * 2.5));

      if (!isExcitatory) {
        ctx.setLineDash([4, 4]); // Dashed for inhibitory
      } else {
        ctx.setLineDash([]);
      }
      ctx.stroke();
      ctx.setLineDash([]);

      // Draw active synaptic transmission pulse dot
      if (s[i] > 0.15) {
        const t = (1.0 - s[i]); // Pulse travelling from i to j
        const px = x1 + (x2 - x1) * t;
        const py = y1 + (y2 - y1) * t;
        ctx.fillStyle = isExcitatory ? colorAccent2 : colorErr;
        ctx.beginPath();
        ctx.arc(px, py, 2.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  // ---- 2. Neuron Soma Nodes ----
  const baseRadius = Math.min(graphW, h) * 0.07;

  for (let i = 0; i < MAX_NEURONS; i++) {
    const nx = nodeX[i] * graphW;
    const ny = nodeY[i] * h;
    const isHovered = (hoveredNeuron === i);
    const spike = spikeAnim[i];
    const nodeRadius = baseRadius + (spike * 5);

    // Soma background
    ctx.fillStyle = colorPanel2;
    ctx.beginPath();
    ctx.arc(nx, ny, nodeRadius, 0, Math.PI * 2);
    ctx.fill();

    // Depolarization voltage fill (v from -1.5 to +1.8)
    const normV = Math.max(0.0, Math.min(1.0, (v[i] + 1.2) / 2.6));
    ctx.fillStyle = spike > 0.05 ? colorOk : (normV > 0.6 ? colorAccent : colorLineFocus);
    ctx.beginPath();
    ctx.arc(nx, ny, nodeRadius * Math.max(0.2, normV), 0, Math.PI * 2);
    ctx.fill();

    // Outer border ring
    ctx.strokeStyle = spike > 0.05 ? "#ffffff" : (isHovered ? colorAccent2 : colorLine);
    ctx.lineWidth = spike > 0.05 ? 3 : (isHovered ? 2 : 1.5);
    ctx.beginPath();
    ctx.arc(nx, ny, nodeRadius, 0, Math.PI * 2);
    ctx.stroke();

    // Note Name & Voice Index inside node
    const midiPitch = getNeuronNote(i);
    const noteText = midiName(midiPitch);

    ctx.font = "bold 10px monospace";
    ctx.fillStyle = spike > 0.2 ? "#ffffff" : colorFg;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(noteText, nx, ny - 3);

    ctx.font = "8px monospace";
    ctx.fillStyle = colorDim;
    ctx.fillText(`N${i + 1}`, nx, ny + 8);
  }

  // ---- 3. Multichannel Oscilloscope Trace (Right Panel) ----
  ctx.fillStyle = colorPanel2;
  ctx.fillRect(scopeX + 4, 4, scopeW - 8, h - 8);
  ctx.strokeStyle = colorLine;
  ctx.lineWidth = 1;
  ctx.strokeRect(scopeX + 4, 4, scopeW - 8, h - 8);

  // Title header
  ctx.font = "9px monospace";
  ctx.fillStyle = colorDim;
  ctx.textAlign = "left";
  ctx.fillText("MEMBRANE TRACES v(t)", scopeX + 10, 16);

  const scopeH = (h - 28) / MAX_NEURONS;

  for (let i = 0; i < MAX_NEURONS; i++) {
    const trackY = 24 + i * scopeH;
    const midY = trackY + scopeH / 2;

    // Track baseline
    ctx.strokeStyle = colorLine;
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(scopeX + 8, midY);
    ctx.lineTo(w - 8, midY);
    ctx.stroke();

    // Voice label
    ctx.font = "8px monospace";
    ctx.fillStyle = colorDim;
    ctx.textAlign = "left";
    ctx.fillText(`N${i + 1}`, scopeX + 8, trackY + 8);

    // Wave trace
    ctx.strokeStyle = spikeAnim[i] > 0.1 ? colorOk : colorAccent;
    ctx.lineWidth = 1.2;
    ctx.beginPath();

    const stepX = (scopeW - 32) / HISTORY_LEN;

    for (let s = 0; s < HISTORY_LEN; s++) {
      const bufIdx = (traceHead + s) % HISTORY_LEN;
      const valV = traceBuffer[i * HISTORY_LEN + bufIdx];
      // Normalize v in [-2.0, 2.0] into track height
      const py = midY - (valV / 2.2) * (scopeH * 0.42);
      const px = scopeX + 26 + s * stepX;

      if (s === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();
  }

  // Bottom info readout
  ctx.font = "9px monospace";
  ctx.fillStyle = colorDim;
  ctx.textAlign = "left";
  ctx.fillText(`Mean Membrane Potential: ${meanPotential.toFixed(2)}`, 10, h - 8);
}

/**
 * Generator Function Contract: generateFitzhughNagumoBank(state).
 * Returns a valid bank array of pattern objects for 64-step sync mode.
 */
export function generateFitzhughNagumoBank(stateObj) {
  const seqLen = stateObj?.length || 64;
  const rateIdx = stateObj?.rate !== undefined ? stateObj.rate : 3;

  const steps = [];

  for (let s = 0; s < seqLen; s++) {
    const idx = s % MAX_NEURONS;
    const note = getNeuronNote(idx);
    const isDownbeat = (s % 8 === 0);

    steps.push({
      note,
      vel: isDownbeat ? 112 : 85,
      notes: [{ note, vel: isDownbeat ? 112 : 85 }],
      gate: 1,
      accent: isDownbeat ? 1 : 0,
      slide: 0,
      pitchMidi: note,
      source: "fitzhugh_nagumo",
      neuronIdx: idx
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
export function isFhnRunning() {
  return isFhnPlaying;
}

export function startFhn() {
  if (isFhnPlaying) return;
  isFhnPlaying = true;
  audio.unlock();
  status("FitzHugh-Nagumo: Spiking neural network active", "ok");
}

export function stopFhn() {
  isFhnPlaying = false;
  releasePolyVoices();
  panicPreview();
  try { audio.allOff(); } catch (_) {}
  status("FitzHugh-Nagumo: Stopped", "warn");
}

export function toggleFhnRunning() {
  if (isFhnPlaying) stopFhn();
  else startFhn();
}

/**
 * Synchronize UI controls with state values.
 */
export function syncFhnControls() {
  if (refs.fhnPreset?.setValue) refs.fhnPreset.setValue(state.fhnPreset, false);
  if (refs.fhnStimulus?.setValue) refs.fhnStimulus.setValue(Number(state.fhnStimulus ?? 1.0), false);
  if (refs.fhnWeight?.setValue) refs.fhnWeight.setValue(Number(state.fhnWeight ?? 1.0), false);
  if (refs.fhnRecovery?.setValue) refs.fhnRecovery.setValue(Number(state.fhnRecovery ?? 0.08), false);
  if (refs.fhnNoise?.setValue) refs.fhnNoise.setValue(Number(state.fhnNoise ?? 0.04), false);
  if (refs.fhnSpan?.setValue) refs.fhnSpan.setValue(Number(state.fhnSpan ?? state.pitchSpan ?? 2), false);
}

/**
 * Randomize FitzHugh-Nagumo node placement, topology, and local model controls.
 */
export function randomizeFitzhughNagumo() {
  state.fhnStimulus = Number((0.4 + Math.random() * 1.3).toFixed(2));
  state.fhnWeight = Number((0.4 + Math.random() * 1.8).toFixed(2));
  state.fhnRecovery = Number((0.03 + Math.random() * 0.12).toFixed(2));
  state.fhnNoise = Number((0.01 + Math.random() * 0.20).toFixed(2));
  state.fhnSpan = Math.round(1 + Math.random() * 3);
  state.pitchSpan = state.fhnSpan;

  const presets = FHN_PRESETS.map(p => p.id);
  state.fhnPreset = presets[Math.floor(Math.random() * presets.length)];

  initNetwork(state.fhnPreset);
  randomizeNeuronPositions();

  let nonZeroSynapses = 0;
  for (let i = 0; i < MAX_NEURONS * MAX_NEURONS; i++) {
    if (W[i] !== 0) nonZeroSynapses++;
  }
  if (nonZeroSynapses < 4) {
    for (let i = 0; i < MAX_NEURONS; i++) {
      const target = (i + 1 + Math.floor(Math.random() * (MAX_NEURONS - 1))) % MAX_NEURONS;
      W[i * MAX_NEURONS + target] = Number((0.3 + Math.random() * 0.5).toFixed(2));
    }
  }

  injectStimulus(Math.floor(Math.random() * MAX_NEURONS), 2.5);
  syncFhnControls();
  renderCanvas();
  doGenerate(true);
  status("FitzHugh-Nagumo: Randomized node placement and model controls", "ok");
}

/**
 * Model Activation / Deactivation Lifecycle
 */
export function activateFitzhughNagumoModel() {
  setModelGenerator(generateFitzhughNagumoBank);
  setModelRandomizer(randomizeFitzhughNagumo);
  setModelStepHandler((stepIdx) => {
    // In SYNC mode: advance simulation step
    stepSimulation(32);
    renderCanvas();
  });
  setModelTransportHandler({
    start: startFhn,
    stop: stopFhn,
    toggle: toggleFhnRunning,
    isRunning: isFhnRunning
  });

  stopFhn();
  lastFrameTime = typeof performance !== "undefined" && performance.now ? performance.now() : 0;
  if (!animFrameId && typeof requestAnimationFrame === "function") {
    animFrameId = requestAnimationFrame(animationTick);
  }
}

export function deactivateFitzhughNagumoModel() {
  setModelGenerator(null);
  setModelRandomizer(null);
  setModelStepHandler(null);
  setModelTransportHandler(null);
  stopFhn();
  if (animFrameId) {
    if (typeof cancelAnimationFrame === "function") {
      cancelAnimationFrame(animFrameId);
    }
    animFrameId = null;
  }
}

function animationTick(now) {
  if (getActiveModel() === "fitzhugh_nagumo") {
    const dt = Math.min(50, now - lastFrameTime);
    lastFrameTime = now;

    if (isFhnPlaying) {
      stepSimulation(dt);
    }
    renderCanvas();

    if (typeof requestAnimationFrame === "function") {
      animFrameId = requestAnimationFrame(animationTick);
    } else {
      animFrameId = null;
    }
  } else {
    animFrameId = null;
  }
}

/**
 * Snapshot Registration
 */
registerModel({
  id: "fitzhugh_nagumo",
  version: 1,
  migrations: {},
  capture: () => ({
    preset: state.fhnPreset || "synfire",
    stimulus: state.fhnStimulus ?? 1.0,
    weight: state.fhnWeight ?? 1.0,
    recovery: state.fhnRecovery ?? 0.08,
    noise: state.fhnNoise ?? 0.04,
    span: state.fhnSpan ?? 2,
    v: Array.from(v),
    w: Array.from(w),
    W: Array.from(W),
    nodeX: Array.from(nodeX),
    nodeY: Array.from(nodeY)
  }),
  restore: (data) => {
    if (!data) return;
    if (data.preset) setState("fhnPreset", data.preset);
    if (data.stimulus !== undefined) setState("fhnStimulus", data.stimulus);
    if (data.weight !== undefined) setState("fhnWeight", data.weight);
    if (data.recovery !== undefined) setState("fhnRecovery", data.recovery);
    if (data.noise !== undefined) setState("fhnNoise", data.noise);
    if (data.span !== undefined) setState("fhnSpan", data.span);

    if (Array.isArray(data.v)) {
      for (let i = 0; i < Math.min(MAX_NEURONS, data.v.length); i++) v[i] = data.v[i];
    }
    if (Array.isArray(data.w)) {
      for (let i = 0; i < Math.min(MAX_NEURONS, data.w.length); i++) w[i] = data.w[i];
    }
    if (Array.isArray(data.W)) {
      for (let i = 0; i < Math.min(MAX_NEURONS * MAX_NEURONS, data.W.length); i++) W[i] = data.W[i];
    }
    if (Array.isArray(data.nodeX)) {
      for (let i = 0; i < Math.min(MAX_NEURONS, data.nodeX.length); i++) nodeX[i] = data.nodeX[i];
    }
    if (Array.isArray(data.nodeY)) {
      for (let i = 0; i < Math.min(MAX_NEURONS, data.nodeY.length); i++) nodeY[i] = data.nodeY[i];
    }
    syncFhnControls();
    renderCanvas();
  }
});

/**
 * Initialize DOM Elements & Interactive Event Listeners.
 */
export function initFitzhughNagumo() {
  container = document.getElementById("model-fitzhugh_nagumo");
  if (!container) return;

  container.innerHTML = `
    <div class="fhn-workbench" style="display: flex; flex-direction: column; gap: 8px; width: 100%;">
      <!-- Controls Toolbar -->
      <div class="fhn-toolbar" style="display: flex; flex-wrap: wrap; align-items: center; gap: 10px; background: var(--panel2); padding: 8px 12px; border: 1px solid var(--line);">
        <div id="fhn-preset-ctrl"></div>
        <div id="fhn-stim-ctrl"></div>
        <div id="fhn-weight-ctrl"></div>
        <div id="fhn-rec-ctrl"></div>
        <div id="fhn-noise-ctrl"></div>
        <div id="fhn-span-ctrl"></div>
        <div style="display: flex; gap: 6px; margin-left: auto;">
          <button id="fhn-rnd-btn" class="btn" title="Randomise node placement and model controls">RND</button>
          <button id="fhn-pulse-btn" class="btn" title="Inject current pulse into Neuron 1">Inject Pulse</button>
          <button id="fhn-reset-btn" class="btn" title="Reset membrane potentials to resting state">Reset</button>
        </div>
      </div>

      <!-- Interactive Neural Canvas -->
      <div class="fhn-canvas-wrap" style="position: relative; width: 100%; border: 1px solid var(--line); background: var(--panel);">
        <canvas id="fhn-canvas" width="680" height="320" style="display: block; width: 100%; height: auto; cursor: crosshair;"></canvas>
      </div>
    </div>
  `;

  canvas = document.getElementById("fhn-canvas");
  if (canvas) {
    ctx = canvas.getContext("2d");
  }

  // Preset Dropdown
  const presetCtrl = document.getElementById("fhn-preset-ctrl");
  if (presetCtrl) {
    presetCtrl.appendChild(
      R("fhnPreset", dropdown({
        label: "Topology",
        tip: "Neuromorphic biophysical synaptic connection network topology preset",
        options: FHN_PRESETS.map(p => ({ value: p.id, label: p.name })),
        value: state.fhnPreset || "synfire",
        onChange: (val) => {
          setState("fhnPreset", val);
          const p = FHN_PRESETS.find(x => x.id === val);
          if (p) {
            setState("fhnStimulus", 1.0);
            setState("fhnWeight", 1.0);
            setState("fhnRecovery", p.recovery);
            setState("fhnNoise", p.noise);
            status(`Topology: ${p.name} — ${p.desc}`);
          }
          initNetwork(val);
          renderCanvas();
        }
      }))
    );
  }

  // Stimulus Excitability Knob
  const stimCtrl = document.getElementById("fhn-stim-ctrl");
  if (stimCtrl) {
    stimCtrl.appendChild(
      R("fhnStimulus", knob({
        label: "Bias I",
        tip: "Tonic depolarizing current injected into neurons to provoke spontaneous action potentials",
        min: 0.0,
        max: 2.0,
        step: 0.05,
        value: Number(state.fhnStimulus ?? 1.0),
        unit: "x",
        onChange: (v) => {
          setState("fhnStimulus", v);
          renderCanvas();
        }
      }))
    );
  }

  // Synaptic Weight Knob
  const weightCtrl = document.getElementById("fhn-weight-ctrl");
  if (weightCtrl) {
    weightCtrl.appendChild(
      R("fhnWeight", knob({
        label: "Weight W",
        tip: "Global synaptic coupling conductance scaling across the neural circuit",
        min: 0.0,
        max: 3.0,
        step: 0.05,
        value: Number(state.fhnWeight ?? 1.0),
        unit: "x",
        onChange: (v) => {
          setState("fhnWeight", v);
          renderCanvas();
        }
      }))
    );
  }

  // Recovery Rate Epsilon Knob
  const recCtrl = document.getElementById("fhn-rec-ctrl");
  if (recCtrl) {
    recCtrl.appendChild(
      R("fhnRecovery", knob({
        label: "Recov ε",
        tip: "Recovery timescale ε (higher = brief spikes and quick reset, lower = sustained bursts)",
        min: 0.02,
        max: 0.20,
        step: 0.01,
        value: Number(state.fhnRecovery ?? 0.08),
        onChange: (v) => {
          setState("fhnRecovery", v);
          renderCanvas();
        }
      }))
    );
  }

  // Noise Knob
  const noiseCtrl = document.getElementById("fhn-noise-ctrl");
  if (noiseCtrl) {
    noiseCtrl.appendChild(
      R("fhnNoise", knob({
        label: "Noise",
        tip: "Stochastic membrane current noise driving random biological firing",
        min: 0.0,
        max: 0.40,
        step: 0.01,
        value: Number(state.fhnNoise ?? 0.04),
        onChange: (v) => {
          setState("fhnNoise", v);
          renderCanvas();
        }
      }))
    );
  }

  // Pitch Span Knob
  const spanCtrl = document.getElementById("fhn-span-ctrl");
  if (spanCtrl) {
    spanCtrl.appendChild(
      R("fhnSpan", knob({
        label: "Span",
        tip: "Pitch span in octaves mapped across the 8 neuromorphic neurons",
        min: 1,
        max: 4,
        step: 1,
        value: Number(state.fhnSpan ?? 2),
        unit: "oct",
        onChange: (v) => {
          setState("fhnSpan", v);
          renderCanvas();
        }
      }))
    );
  }

  // Buttons
  const rndBtn = document.getElementById("fhn-rnd-btn");
  if (rndBtn) {
    rndBtn.addEventListener("click", () => {
      randomizeFitzhughNagumo();
    });
  }

  const pulseBtn = document.getElementById("fhn-pulse-btn");
  if (pulseBtn) {
    pulseBtn.addEventListener("click", () => {
      injectStimulus(0, 2.5);
      status("Injected depolarizing current pulse into Neuron 1");
      renderCanvas();
    });
  }

  const resetBtn = document.getElementById("fhn-reset-btn");
  if (resetBtn) {
    resetBtn.addEventListener("click", () => {
      resetMembranes();
      status("Reset membrane potentials to resting state");
      renderCanvas();
    });
  }

  setupCanvasInteraction();
  initNetwork(state.fhnPreset || "synfire");
  setModelRandomizer(randomizeFitzhughNagumo);
  renderCanvas();
}

/**
 * Direct Manipulation: Click or drag on a neuron node to depolarize it and force action potential.
 */
function setupCanvasInteraction() {
  if (!canvas) return;

  function getNodeUnderCursor(e) {
    const rect = canvas.getBoundingClientRect();
    const graphW = canvas.width * 0.68;
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const mx = (e.clientX - rect.left) * scaleX;
    const my = (e.clientY - rect.top) * scaleY;

    if (mx > graphW) return -1; // Clicked on oscilloscope

    const baseRadius = Math.min(graphW, canvas.height) * 0.07;

    for (let i = 0; i < MAX_NEURONS; i++) {
      const nx = nodeX[i] * graphW;
      const ny = nodeY[i] * canvas.height;
      const dist = Math.hypot(mx - nx, my - ny);
      if (dist <= baseRadius + 4) {
        return i;
      }
    }
    return -1;
  }

  canvas.addEventListener("mousemove", (e) => {
    const node = getNodeUnderCursor(e);
    if (node !== hoveredNeuron) {
      hoveredNeuron = node;
      renderCanvas();
    }
  });

  canvas.addEventListener("mouseleave", () => {
    hoveredNeuron = -1;
    renderCanvas();
  });

  canvas.addEventListener("mousedown", (e) => {
    const node = getNodeUnderCursor(e);
    if (node !== -1) {
      injectStimulus(node, 2.5);
      status(`Stimulated Neuron N${node + 1} (${midiName(getNeuronNote(node))})`);
      renderCanvas();
    }
  });
}
