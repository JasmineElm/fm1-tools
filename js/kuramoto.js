// kuramoto.js — Coupled Kuramoto Phase Synchronization Oscillators Sequencer for FM-1 Pulses.
// Non-linear dynamics, collective phase locking, and macroscopic order parameter modulation.
//
// Generative Architecture:
// 1. Kuramoto Mean-Field Coupling Engine:
//    - N non-linear phase oscillators (up to 8, strictly matching the M-VAVE FM-1's hardware polyphony ceiling).
//    - d(theta_i)/dt = omega_i + K * r * sin(psi - theta_i) + noise * xi_i
//    - Macroscopic complex order parameter: r * e^(i * psi) = (1/N) * sum(e^(i * theta_j))
// 2. Rhythmic Dynamics & Phase Locking:
//    - Disordered Phase (r < 0.35): Independent wandering polyrhythmic cascades and gamelan-like ripples.
//    - Critical Transition (0.35 <= r <= 0.85): Interlocking harmonic clusters, dyads, and triads.
//    - Synchronized State (r > 0.85): Unified, massive downbeat chords striking simultaneously!
// 3. Scale Quantization & Pitch Mapping:
//    - Higher natural frequencies omega_i map to higher scale degrees and octave shifts via js/scale.js.
// 4. Continuous Timbre CC #74 Modulation:
//    - Macroscopic order parameter r(t) directly modulates CC #74 Brightness via dispatchTimbreCc().
// 5. Direct Manipulation Flat Workbench Visualizer:
//    - Interactive circular phase dial showing each oscillator orbiting around a central ring.
//    - Central coherence vector displays collective order parameter r and mean phase psi.
//    - Drag oscillator beads around the ring to manually perturb phase angles and disrupt synchronization!
// 6. Strict 8-Voice Hardware Ceiling via js/poly.js.
// 7. Zero GC Churn: Pre-allocated TypedArrays (Float32Array, Uint8Array).

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

// ---- Constants & Pre-allocated TypedArray Buffers (Zero GC Churn) ----
export const MAX_OSCILLATORS = 8; // Hardware FM-1 8 voice ceiling

export const theta = new Float32Array(MAX_OSCILLATORS);
export const omega = new Float32Array(MAX_OSCILLATORS);
export const prevTheta = new Float32Array(MAX_OSCILLATORS);
export const pulseAnim = new Float32Array(MAX_OSCILLATORS);
export const activeOsc = new Uint8Array(MAX_OSCILLATORS);

// Presets
export const KURAMOTO_PRESETS = [
  { id: "near_sync", name: "Near Sync (Chords)", K: 2.2, sigma: 0.15, noise: 0.05, desc: "Strong coupling; periodic collective downbeat chord bursts" },
  { id: "polyrhythm", name: "Polyrhythmic Ratios", K: 0.35, sigma: 0.65, noise: 0.02, desc: "Harmonic frequency ratios producing interlocking gamelan chimes" },
  { id: "critical", name: "Critical Metastability", K: 0.95, sigma: 0.45, noise: 0.12, desc: "Hovering on the brink of synchronization; fluctuating order parameter" },
  { id: "bimodal", name: "Bimodal Clusters", K: 1.4, sigma: 0.85, noise: 0.08, desc: "Two frequency clusters alternating in call-and-response counterpoint" },
  { id: "chaotic", name: "Desynchronized Drift", K: 0.15, sigma: 1.2, noise: 0.35, desc: "Weak coupling with high noise; wandering aleatoric cloud" }
];

// Runtime State
let isKuramotoPlaying = false;
let animFrameId = null;
let lastFrameTime = 0;
let orderR = 0;
let orderPsi = 0;

// UI & Canvas References
let container = null;
let canvas = null;
let ctx = null;
let dragOscIdx = -1;

/**
 * Initialize oscillator parameters according to preset.
 */
export function initOscillators(presetId = state.kuramotoPreset || "near_sync") {
  const preset = KURAMOTO_PRESETS.find(p => p.id === presetId) || KURAMOTO_PRESETS[0];
  const baseFreq = Math.max(0.2, Math.min(3.0, Number(state.kuramotoBaseFreq ?? 1.0)));
  const sigma = Number(state.kuramotoSigma ?? preset.sigma);

  for (let i = 0; i < MAX_OSCILLATORS; i++) {
    activeOsc[i] = 1;
    pulseAnim[i] = 0;
    // Distribute initial phase uniformly around circle
    theta[i] = (i * Math.PI * 2) / MAX_OSCILLATORS;
    prevTheta[i] = theta[i];

    // Assign natural frequency
    if (preset.id === "bimodal") {
      const cluster = i < 4 ? -1 : 1;
      omega[i] = baseFreq * (1.0 + cluster * 0.35 + (Math.random() - 0.5) * sigma * 0.2);
    } else if (preset.id === "polyrhythm") {
      // Natural ratios: 1, 1.25, 1.33, 1.5, 1.66, 1.875, 2.0, 2.25
      const ratios = [1.0, 1.25, 1.333, 1.5, 1.667, 1.875, 2.0, 2.25];
      omega[i] = baseFreq * ratios[i];
    } else {
      // Gaussian/Lorentzian spread around base frequency
      const spread = (i - (MAX_OSCILLATORS - 1) / 2) * (sigma / (MAX_OSCILLATORS / 2));
      omega[i] = Math.max(0.1, baseFreq * (1.0 + spread));
    }
  }
}

/**
 * Compute the complex order parameter: r * e^(i * psi) = (1/N) * sum(e^(i * theta_j))
 */
export function computeOrderParameter() {
  let sumCos = 0;
  let sumSin = 0;
  let count = 0;

  for (let i = 0; i < MAX_OSCILLATORS; i++) {
    if (!activeOsc[i]) continue;
    sumCos += Math.cos(theta[i]);
    sumSin += Math.sin(theta[i]);
    count++;
  }

  if (count === 0) {
    orderR = 0;
    orderPsi = 0;
    return { r: 0, psi: 0 };
  }

  const meanCos = sumCos / count;
  const meanSin = sumSin / count;
  orderR = Math.hypot(meanCos, meanSin);
  orderPsi = Math.atan2(meanSin, meanCos);

  return { r: orderR, psi: orderPsi };
}

/**
 * Map oscillator index and natural frequency to scale-quantized MIDI pitch.
 */
export function getOscillatorNote(idx) {
  const intervals = getActiveScaleIntervals();
  const root = getRootMidi();
  const span = Math.min(4, Math.max(1, Number(state.kuramotoSpan ?? 2)));

  // Degree based on index (0 to 7)
  const numDeg = intervals.length || 7;
  const deg = idx % numDeg;

  // Octave shift based on frequency ranking
  const oct = Math.min(span, Math.floor((idx / MAX_OSCILLATORS) * (span + 1)));

  const rawMidi = root + oct * 12 + (intervals[deg] ?? 0);
  return quantize(rawMidi, intervals, root);
}

/**
 * Execute one numerical integration step of the Kuramoto phase model.
 */
export function stepSimulation(dtMs = 16) {
  const speedMult = Math.max(0.1, Number(state.modelSpeed ?? 1.0));
  const effectiveDt = (dtMs / 1000) * speedMult * 2.5;

  const currentPreset = KURAMOTO_PRESETS.find(p => p.id === (state.kuramotoPreset || "near_sync")) || KURAMOTO_PRESETS[0];
  const K = Math.max(0.0, Math.min(5.0, Number(state.kuramotoCoupling ?? currentPreset.K)));
  const noiseAmt = Math.max(0.0, Math.min(1.0, Number(state.kuramotoNoise ?? currentPreset.noise)));

  // Compute order parameter
  const { r, psi } = computeOrderParameter();

  // Evolve phases: d(theta_i)/dt = omega_i + K * r * sin(psi - theta_i) + noise * xi_i
  for (let i = 0; i < MAX_OSCILLATORS; i++) {
    if (!activeOsc[i]) continue;

    prevTheta[i] = theta[i];

    const couplingTerm = K * r * Math.sin(psi - theta[i]);
    const noiseTerm = noiseAmt * (Math.random() - 0.5) * 4.0;
    const dTheta = (omega[i] + couplingTerm + noiseTerm) * effectiveDt;

    theta[i] = (theta[i] + dTheta) % (Math.PI * 2);
    if (theta[i] < 0) theta[i] += Math.PI * 2;

    // Pulse animation decay
    if (pulseAnim[i] > 0.01) {
      pulseAnim[i] *= 0.88;
    } else {
      pulseAnim[i] = 0;
    }

    // Zenith crossing trigger check: phase passing top zenith (angle 0 / 2PI)
    // Detected when prevTheta was near 2PI and current theta wrapped past 0
    const crossedZenith = (prevTheta[i] > Math.PI && theta[i] < Math.PI && (prevTheta[i] - theta[i]) > Math.PI) ||
                          (prevTheta[i] < theta[i] && prevTheta[i] < 0.15 && theta[i] >= 0.15);

    if (crossedZenith) {
      pulseAnim[i] = 1.0;

      if (isKuramotoPlaying) {
        const note = getOscillatorNote(i);
        // Note velocity is modulated by collective order parameter r
        const vel = Math.max(45, Math.min(127, Math.round(75 + r * 50)));
        const durMs = Math.round(200 + (1.0 - Math.min(1.0, omega[i] / 3.0)) * 250);

        // Dispatch voice strictly through poly.js manager (slot i, 0 to 7)
        playVoice(`kuramoto_${i}`, note, vel, durMs);
      }
    }
  }

  // Continuous Timbre CC #74 Brightness Modulation driven by order parameter r
  dispatchTimbreCc(r, 0.5, 200);
}

/**
 * Render Kuramoto phase dial and coherence vector.
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

  const cx = w / 2;
  const cy = h / 2 + 10;
  const radius = Math.min(w, h) * 0.36;

  // 1. Outer Phase Ring
  ctx.strokeStyle = colorLine;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.stroke();

  // Top Zenith Strike Marker
  ctx.strokeStyle = colorLineFocus;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(cx, cy - radius - 10);
  ctx.lineTo(cx, cy - radius + 10);
  ctx.stroke();

  ctx.font = "9px monospace";
  ctx.fillStyle = colorDim;
  ctx.textAlign = "center";
  ctx.fillText("ZENITH (TRIGGER)", cx, cy - radius - 14);

  // 2. Central Coherence Vector (Order Parameter r and Mean Phase psi)
  const vecLen = radius * orderR;
  const vx = cx + Math.cos(orderPsi - Math.PI / 2) * vecLen;
  const vy = cy + Math.sin(orderPsi - Math.PI / 2) * vecLen;

  // Vector line
  ctx.strokeStyle = orderR > 0.8 ? colorOk : (orderR > 0.4 ? colorAccent : colorLineFocus);
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(vx, vy);
  ctx.stroke();

  // Center pivot node
  ctx.fillStyle = colorPanel2;
  ctx.strokeStyle = colorLineFocus;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(cx, cy, 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // Vector head arrow
  ctx.fillStyle = orderR > 0.8 ? colorOk : colorAccent;
  ctx.beginPath();
  ctx.arc(vx, vy, 4, 0, Math.PI * 2);
  ctx.fill();

  // 3. Draw 8 Phase Oscillator Beads orbiting around the ring
  for (let i = 0; i < MAX_OSCILLATORS; i++) {
    if (!activeOsc[i]) continue;

    // Angle offset so 0 is at top zenith (-PI/2)
    const angle = theta[i] - Math.PI / 2;
    const ox = cx + Math.cos(angle) * radius;
    const oy = cy + Math.sin(angle) * radius;
    const pulse = pulseAnim[i];

    // Strike excitation ring
    if (pulse > 0.05) {
      ctx.strokeStyle = colorOk;
      ctx.lineWidth = 1 + pulse * 2.5;
      ctx.beginPath();
      ctx.arc(ox, oy, 10 + (1.0 - pulse) * 16, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Outer bead circle
    ctx.fillStyle = pulse > 0.05 ? colorOk : colorPanel2;
    ctx.strokeStyle = pulse > 0.05 ? colorFg : colorAccent;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(ox, oy, 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Bead label: Note name
    const noteMidi = getOscillatorNote(i);
    const label = `${midiName(noteMidi)}`;
    ctx.font = "bold 9px monospace";
    ctx.fillStyle = pulse > 0.05 ? colorOk : colorFg;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, ox, oy);

    // Oscillator Voice ID outside ring
    const labelDist = radius + 20;
    const lx = cx + Math.cos(angle) * labelDist;
    const ly = cy + Math.sin(angle) * labelDist;
    ctx.font = "8px monospace";
    ctx.fillStyle = colorDim;
    ctx.fillText(`V${i + 1}`, lx, ly);
  }

  // 4. Header Status Bar
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.font = "10px monospace";
  ctx.fillStyle = colorDim;
  ctx.fillText("COUPLED KURAMOTO PHASE SYNCHRONIZATION", 12, 16);

  ctx.textAlign = "right";
  const syncStateText = orderR > 0.85 ? "LOCKED CHORD" : (orderR > 0.45 ? "PARTIAL CLUSTERS" : "POLYRHYTHMIC DRIFT");
  ctx.fillStyle = orderR > 0.85 ? colorOk : (orderR > 0.45 ? colorAccent : colorDim);
  ctx.fillText(`COHERENCE r: ${(orderR * 100).toFixed(0)}% [${syncStateText}]`, w - 12, 16);
}

/**
 * Main animation tick.
 */
function animationTick(now) {
  if (!lastFrameTime) lastFrameTime = now;
  const dt = Math.min(100, now - lastFrameTime);
  lastFrameTime = now;

  if (isKuramotoPlaying) {
    stepSimulation(dt);
  }

  renderCanvas();
  animFrameId = requestAnimationFrame(animationTick);
}

/**
 * Direct canvas interaction: Drag oscillator beads around ring to perturb phase.
 */
function setupCanvasInteraction() {
  if (!canvas) return;

  canvas.style.cursor = "pointer";

  function getAngleFromCoords(e) {
    const rect = canvas.getBoundingClientRect();
    const cx = rect.width / 2;
    const cy = rect.height / 2 + 10;
    const mx = e.clientX - rect.left - cx;
    const my = e.clientY - rect.top - cy;
    let ang = Math.atan2(my, mx) + Math.PI / 2;
    if (ang < 0) ang += Math.PI * 2;
    return ang % (Math.PI * 2);
  }

  canvas.addEventListener("mousedown", (e) => {
    const rect = canvas.getBoundingClientRect();
    const cx = canvas.width / 2;
    const cy = canvas.height / 2 + 10;
    const radius = Math.min(canvas.width, canvas.height) * 0.36;
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const mx = (e.clientX - rect.left) * scaleX;
    const my = (e.clientY - rect.top) * scaleY;

    // Check if clicked near an existing oscillator bead
    dragOscIdx = -1;
    for (let i = 0; i < MAX_OSCILLATORS; i++) {
      if (!activeOsc[i]) continue;
      const angle = theta[i] - Math.PI / 2;
      const ox = cx + Math.cos(angle) * radius;
      const oy = cy + Math.sin(angle) * radius;
      const dist = Math.hypot(mx - ox, my - oy);

      if (dist <= 14) {
        dragOscIdx = i;
        break;
      }
    }

    if (dragOscIdx !== -1) {
      theta[dragOscIdx] = getAngleFromCoords(e);
      renderCanvas();
    }
  });

  window.addEventListener("mousemove", (e) => {
    if (dragOscIdx === -1) return;
    theta[dragOscIdx] = getAngleFromCoords(e);
    renderCanvas();
  });

  window.addEventListener("mouseup", () => {
    if (dragOscIdx !== -1) {
      status(`Perturbed Oscillator V${dragOscIdx + 1} Phase -> Observing resynchronization`);
      dragOscIdx = -1;
    }
  });
}

/**
 * Generator Function Contract: generateKuramotoBank(state).
 * Returns a valid bank array of pattern objects for 64-step sync mode.
 */
export function generateKuramotoBank(stateObj) {
  const seqLen = stateObj?.length || 64;
  const rateIdx = stateObj?.rate !== undefined ? stateObj.rate : 3;

  const steps = [];

  for (let s = 0; s < seqLen; s++) {
    const idx = s % MAX_OSCILLATORS;
    const note = getOscillatorNote(idx);
    const isDownbeat = (s % 8 === 0);

    steps.push({
      note,
      vel: isDownbeat ? 115 : 88,
      notes: [{ note, vel: isDownbeat ? 115 : 88 }],
      gate: 1,
      accent: isDownbeat ? 1 : 0,
      slide: 0,
      pitchMidi: note,
      source: "kuramoto",
      oscIdx: idx
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
export function isKuramotoRunning() {
  return isKuramotoPlaying;
}

export function startKuramoto() {
  if (isKuramotoPlaying) return;
  isKuramotoPlaying = true;
  audio.unlock();
  updatePlayBtnUI();
  status("Kuramoto Oscillators: Phase synchronization active", "ok");
}

export function stopKuramoto() {
  isKuramotoPlaying = false;
  releasePolyVoices();
  updatePlayBtnUI();
  status("Kuramoto Oscillators: Stopped", "warn");
}

export function toggleKuramotoRunning() {
  if (isKuramotoPlaying) stopKuramoto();
  else startKuramoto();
}

function updatePlayBtnUI() {
  const btn = document.getElementById("kuramoto-play-btn");
  if (!btn) return;
  btn.textContent = isKuramotoPlaying ? "Stop" : "Play";
  btn.className = isKuramotoPlaying ? "btn btn-err" : "btn btn-ok";
}

/**
 * Model Activation / Deactivation Lifecycle
 */
export function activateKuramotoModel() {
  setModelGenerator(generateKuramotoBank);
  setModelStepHandler((stepIdx) => {
    // SYNC mode step: execute simulation advance
    stepSimulation(32);
    renderCanvas();
  });
  setModelTransportHandler({
    start: startKuramoto,
    stop: stopKuramoto,
    toggle: toggleKuramotoRunning,
    isRunning: isKuramotoRunning
  });

  lastFrameTime = performance.now();
  if (!animFrameId) {
    animFrameId = requestAnimationFrame(animationTick);
  }
}

export function deactivateKuramotoModel() {
  setModelGenerator(null);
  setModelStepHandler(null);
  setModelTransportHandler(null);
  isKuramotoPlaying = false;
  releasePolyVoices();

  if (animFrameId) {
    cancelAnimationFrame(animFrameId);
    animFrameId = null;
  }
}

/**
 * Initialize the Kuramoto UI enclosure.
 */
export function initKuramoto() {
  container = document.getElementById("model-kuramoto");
  if (!container) return;

  container.innerHTML = `
    <div class="kuramoto-enclosure">
      <!-- Top Control Bar -->
      <div class="kuramoto-controls" style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-bottom: 8px;">
        <button id="kuramoto-play-btn" class="btn btn-ok" style="min-width: 60px;">Play</button>
        <button id="kuramoto-reset-btn" class="btn" title="Reset phases and random frequencies">Reset</button>

        <label style="font-size: 11px; color: var(--dim); display: flex; align-items: center; gap: 4px;">
          Preset:
          <select id="kuramoto-preset-select" class="select-field" style="padding: 2px 4px; font-size: 11px;">
            ${KURAMOTO_PRESETS.map(p => `<option value="${p.id}" ${p.id === (state.kuramotoPreset || "near_sync") ? "selected" : ""}>${p.name}</option>`).join("")}
          </select>
        </label>

        <label style="font-size: 11px; color: var(--dim); display: flex; align-items: center; gap: 4px;" title="Coupling Strength K (Synchronization force)">
          Coupling K:
          <input type="range" id="kuramoto-coupling" min="0" max="3.5" step="0.1" value="${state.kuramotoCoupling ?? 2.2}" style="width: 70px;">
        </label>

        <label style="font-size: 11px; color: var(--dim); display: flex; align-items: center; gap: 4px;" title="Natural Frequency Dispersion Sigma">
          Dispersion:
          <input type="range" id="kuramoto-sigma" min="0.05" max="1.5" step="0.05" value="${state.kuramotoSigma ?? 0.15}" style="width: 70px;">
        </label>

        <label style="font-size: 11px; color: var(--dim); display: flex; align-items: center; gap: 4px;" title="Thermal Perturbation Noise">
          Noise:
          <input type="range" id="kuramoto-noise" min="0" max="0.5" step="0.02" value="${state.kuramotoNoise ?? 0.05}" style="width: 60px;">
        </label>

        <label style="font-size: 11px; color: var(--dim); display: flex; align-items: center; gap: 4px;" title="Pitch Octave Span">
          Span:
          <input type="range" id="kuramoto-span" min="1" max="4" step="1" value="${state.kuramotoSpan ?? 2}" style="width: 50px;">
        </label>
      </div>

      <!-- Canvas Dial -->
      <div style="position: relative; width: 100%; border: 1px solid var(--line); background: var(--panel);">
        <canvas id="kuramoto-canvas" width="800" height="420" style="width: 100%; height: auto; display: block;"></canvas>
      </div>
      <div style="font-size: 10px; color: var(--dim); margin-top: 4px; display: flex; justify-content: space-between;">
        <span>Direct Manipulation: Drag oscillator beads V1–V8 around the ring to perturb phase angles</span>
        <span>Non-Linear Coupled Kuramoto ODE · Strict 8-Voice Hardware Polyphony Ceiling</span>
      </div>
    </div>
  `;

  canvas = document.getElementById("kuramoto-canvas");
  if (canvas) {
    ctx = canvas.getContext("2d");
    setupCanvasInteraction();
  }

  // Hook buttons
  const playBtn = document.getElementById("kuramoto-play-btn");
  if (playBtn) playBtn.addEventListener("click", toggleKuramotoRunning);

  const resetBtn = document.getElementById("kuramoto-reset-btn");
  if (resetBtn) resetBtn.addEventListener("click", () => {
    initOscillators(state.kuramotoPreset || "near_sync");
    renderCanvas();
    status("Reset Kuramoto oscillator phases and frequencies");
  });

  const presetSelect = document.getElementById("kuramoto-preset-select");
  if (presetSelect) {
    presetSelect.addEventListener("change", (e) => {
      const preset = KURAMOTO_PRESETS.find(p => p.id === e.target.value);
      if (preset) {
        setState({
          kuramotoPreset: preset.id,
          kuramotoCoupling: preset.K,
          kuramotoSigma: preset.sigma,
          kuramotoNoise: preset.noise
        });
        const coupEl = document.getElementById("kuramoto-coupling");
        const sigEl = document.getElementById("kuramoto-sigma");
        const noiseEl = document.getElementById("kuramoto-noise");
        if (coupEl) coupEl.value = preset.K;
        if (sigEl) sigEl.value = preset.sigma;
        if (noiseEl) noiseEl.value = preset.noise;
        initOscillators(preset.id);
        renderCanvas();
        status(`Loaded Kuramoto Preset: ${preset.name}`);
      }
    });
  }

  // Hook sliders
  const bindSlider = (id, stateKey) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener("input", (e) => {
      setState({ [stateKey]: parseFloat(e.target.value) });
    });
  };

  bindSlider("kuramoto-coupling", "kuramotoCoupling");
  bindSlider("kuramoto-sigma", "kuramotoSigma");
  bindSlider("kuramoto-noise", "kuramotoNoise");
  bindSlider("kuramoto-span", "kuramotoSpan");

  // Initial layout and seeding
  initOscillators(state.kuramotoPreset || "near_sync");
  renderCanvas();
}

// ---- Register Snapshot Serialization Contract ----
registerModel({
  id: "kuramoto",
  version: 1,
  migrations: {},
  capture() {
    return {
      preset: state.kuramotoPreset || "near_sync",
      coupling: state.kuramotoCoupling ?? 2.2,
      sigma: state.kuramotoSigma ?? 0.15,
      noise: state.kuramotoNoise ?? 0.05,
      span: state.kuramotoSpan ?? 2,
      theta: Array.from(theta),
      omega: Array.from(omega)
    };
  },
  restore(data) {
    if (!data) return;
    if (data.preset) setState({ kuramotoPreset: data.preset });
    if (data.coupling !== undefined) setState({ kuramotoCoupling: data.coupling });
    if (data.sigma !== undefined) setState({ kuramotoSigma: data.sigma });
    if (data.noise !== undefined) setState({ kuramotoNoise: data.noise });
    if (data.span !== undefined) setState({ kuramotoSpan: data.span });

    if (Array.isArray(data.theta)) {
      for (let i = 0; i < MAX_OSCILLATORS; i++) {
        if (data.theta[i] !== undefined) theta[i] = data.theta[i];
      }
    }
    if (Array.isArray(data.omega)) {
      for (let i = 0; i < MAX_OSCILLATORS; i++) {
        if (data.omega[i] !== undefined) omega[i] = data.omega[i];
      }
    }
    renderCanvas();
  }
});
