// chladni.js — Chladni Resonant Cymatics Plate & Nodal Sand Patterns Sequencer for FM-1 Pulses.
// Standing wave cymatics: 2D eigenfunction nodal lines, sand particle propulsion, harmonic chime pickups, and polyphonic counterpoint.
//
// Generative Architecture:
// 1. Chladni 2D Square Plate Standing Waves:
//    - Solves the free-edge transverse vibration equation:
//      w(x, y) = a * cos(n * pi * x / L) * cos(m * pi * y / L) - b * cos(m * pi * x / L) * cos(n * pi * y / L)
//    - Nodal lines are regions of zero displacement: w(x, y) = 0.
//    - Anti-nodal zones vibrate vigorously, repelling virtual sand grains toward nodal lines.
// 2. Sand Particle Kinematics:
//    - Pre-allocated TypedArrays (Float32Array) for sand positions, velocities, and acoustic forces.
//    - Lateral force proportional to negative vibrational energy gradient: F = -grad(w^2).
//    - Particles settle into intricate geometric Chladni nodal figures (crosses, diamonds, mandalas).
// 3. 8-Voice Hardware Polyphony Ceiling:
//    - 8 hydrophone / pickup probes (P0–P7) positioned across the plate quadrants.
//    - When local sand particle density concentrates near a probe, or during plate bowing impulses,
//      resonant bell / chime harmonics are triggered.
//    - Voice dispatch routed strictly through js/poly.js.
// 4. Continuous Timbre Modulation (CC #74):
//    - Instantaneous RMS vibrational energy of the plate modulates CC #74 Brightness.
// 5. Zero GC Churn: Pre-allocated Float32Array and Int8Array buffers.

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
export const MAX_PROBES = 8;        // Strict FM-1 8 hardware voices limit
export const NUM_SAND_GRAINS = 720; // Virtual sand grains
export const PLATE_SIZE = 1.0;      // Dimensionless normalized plate coordinates [-0.5, +0.5]

// Sand Grain State Buffers (Zero GC Churn)
export const sandX = new Float32Array(NUM_SAND_GRAINS);
export const sandY = new Float32Array(NUM_SAND_GRAINS);
export const sandVx = new Float32Array(NUM_SAND_GRAINS);
export const sandVy = new Float32Array(NUM_SAND_GRAINS);

// Hydrophone / Nodal Pickups
export const probes = [];
for (let i = 0; i < MAX_PROBES; i++) {
  // Symmetrical radial placement
  const angle = (i / MAX_PROBES) * Math.PI * 2;
  const radius = 0.28;
  probes.push({
    id: i,
    x: Math.cos(angle) * radius,
    y: Math.sin(angle) * radius,
    density: 0,
    prevDensity: 0,
    pulseAnim: 0,
    octave: (i % 3)
  });
}

// Chladni Cymatics Presets
export const CHLADNI_PRESETS = [
  {
    id: "concentric_cross",
    name: "Orthogonal Cross",
    desc: "Fundamental mode combination forming a centered cross and square boundary",
    m: 1,
    n: 2,
    a: 1.0,
    b: 1.0,
    drive: 1.2
  },
  {
    id: "diamond_clover",
    name: "Diamond Clover",
    desc: "Four-leaf clover nodal loops and diagonal diamond harmonics",
    m: 2,
    n: 3,
    a: 1.0,
    b: 1.0,
    drive: 1.5
  },
  {
    id: "stellar_mandala",
    name: "Stellar Mandala",
    desc: "Intricate multi-pointed sacred geometry star with dense resonant nodal intersections",
    m: 3,
    n: 5,
    a: 1.0,
    b: 1.0,
    drive: 1.8
  },
  {
    id: "hyperbolic_rosette",
    name: "Hyperbolic Rosette",
    desc: "Checkered standing waves with sharp anti-nodal repulsion ridges",
    m: 4,
    n: 4,
    a: 1.0,
    b: 0.9,
    drive: 2.0
  },
  {
    id: "asymmetric_bell",
    name: "Cathedral Bell",
    desc: "Asymmetric modal weighting mimicking cast bronze church bell overtones",
    m: 2,
    n: 5,
    a: 1.3,
    b: 0.7,
    drive: 1.6
  }
];

// Runtime State
let isChladniPlaying = false;
let animFrameId = null;
let lastFrameTime = 0;
let stepTimerAcc = 0;
let meanVibrationRms = 0.5;
let draggedProbe = -1;

// UI & Canvas References
let container = null;
let canvas = null;
let ctx = null;

/**
 * Configure modal parameters and scatter sand grains according to preset.
 */
export function initChladniPreset(presetId = state.chladniPreset || "concentric_cross") {
  const preset = CHLADNI_PRESETS.find(p => p.id === presetId) || CHLADNI_PRESETS[0];
  state.chladniPreset = preset.id;

  state.chladniM = preset.m;
  state.chladniN = preset.n;
  state.chladniA = preset.a;
  state.chladniB = preset.b;
  state.chladniDrive = preset.drive;

  scatterSandGrains();

  // Reset probe state
  for (let i = 0; i < MAX_PROBES; i++) {
    const angle = (i / MAX_PROBES) * Math.PI * 2;
    const radius = 0.28;
    probes[i].x = Math.cos(angle) * radius;
    probes[i].y = Math.sin(angle) * radius;
    probes[i].density = 0;
    probes[i].prevDensity = 0;
    probes[i].pulseAnim = 0;
    probes[i].octave = (i % 3);
  }
}

/**
 * Scatter sand grains uniformly across the plate.
 */
export function scatterSandGrains() {
  for (let i = 0; i < NUM_SAND_GRAINS; i++) {
    sandX[i] = (Math.random() - 0.5) * 0.92;
    sandY[i] = (Math.random() - 0.5) * 0.92;
    sandVx[i] = (Math.random() - 0.5) * 0.05;
    sandVy[i] = (Math.random() - 0.5) * 0.05;
  }
}

/**
 * Compute Chladni 2D displacement w(x, y) at a given point on the plate.
 */
export function computeDisplacement(x, y, m, n, a = 1.0, b = 1.0) {
  const pi = Math.PI;
  // Map x, y from [-0.5, 0.5] to plate radians
  const term1 = a * Math.cos(n * pi * x) * Math.cos(m * pi * y);
  const term2 = b * Math.cos(m * pi * x) * Math.cos(n * pi * y);
  return term1 - term2;
}

/**
 * Compute gradient of vibrational energy grad(w^2) = 2 * w * grad(w).
 */
export function computeForce(x, y, m, n, a = 1.0, b = 1.0) {
  const eps = 0.005;
  const wCenter = computeDisplacement(x, y, m, n, a, b);
  const wDx = computeDisplacement(x + eps, y, m, n, a, b);
  const wDy = computeDisplacement(x, y + eps, m, n, a, b);

  // Gradient of w^2
  const energyCenter = wCenter * wCenter;
  const energyDx = wDx * wDx;
  const energyDy = wDy * wDy;

  const gradX = (energyDx - energyCenter) / eps;
  const gradY = (energyDy - energyCenter) / eps;

  return { fx: -gradX, fy: -gradY, amp: Math.abs(wCenter) };
}

/**
 * Inject violent acoustic bowing impulse onto the plate.
 */
export function bowImpulse(ix = 0, iy = 0, intensity = 1.0) {
  for (let i = 0; i < NUM_SAND_GRAINS; i++) {
    const dx = sandX[i] - ix;
    const dy = sandY[i] - iy;
    const distSq = dx * dx + dy * dy;
    if (distSq < 0.15) {
      const kick = (0.15 - distSq) * intensity * 0.4;
      sandVx[i] += (Math.random() - 0.5) * kick;
      sandVy[i] += (Math.random() - 0.5) * kick;
    }
  }

  // Trigger nearby probes
  for (let p = 0; p < MAX_PROBES; p++) {
    const pr = probes[p];
    const dx = pr.x - ix;
    const dy = pr.y - iy;
    if (dx * dx + dy * dy < 0.12) {
      pr.pulseAnim = 1.0;
      if (isChladniPlaying) {
        const note = getProbeNote(p);
        playVoice(`chladni_${p}`, note, 115, 260);
      }
    }
  }

  status("Excited plate with acoustic bow impulse");
}

/**
 * Map probe index and plate coordinates to scale-quantized MIDI note.
 */
export function getProbeNote(probeIdx) {
  const pr = probes[probeIdx];
  const intervals = getActiveScaleIntervals();
  const root = getRootMidi();
  const span = Math.min(4, Math.max(1, Number(state.chladniSpan ?? 2)));

  const numDeg = intervals.length || 7;
  // Spatial distance from plate center controls harmonic degree
  const dist = Math.sqrt(pr.x * pr.x + pr.y * pr.y);
  const normDist = Math.min(1.0, dist / 0.5);
  const deg = Math.floor(normDist * numDeg) % numDeg;
  const oct = Math.min(span, pr.octave);

  const rawMidi = root + oct * 12 + (intervals[deg] ?? 0);
  return quantize(rawMidi, intervals, root);
}

/**
 * Step numerical simulation of sand particle movement and probe detection.
 */
export function stepSimulation(dtMs = 16) {
  const speedMult = Math.max(0.1, Number(state.modelSpeed ?? 1.0));
  const m = Number(state.chladniM ?? 2);
  const n = Number(state.chladniN ?? 3);
  const a = Number(state.chladniA ?? 1.0);
  const b = Number(state.chladniB ?? 1.0);
  const drive = Number(state.chladniDrive ?? 1.5) * speedMult;

  const dtSec = Math.min(0.04, dtMs * 0.001);
  const damping = 0.94; // Viscous friction

  let totalAmp = 0;

  // Move sand grains towards nodal lines
  for (let i = 0; i < NUM_SAND_GRAINS; i++) {
    const x = sandX[i];
    const y = sandY[i];

    const { fx, fy, amp } = computeForce(x, y, m, n, a, b);
    totalAmp += amp;

    // Acceleration towards nodes (grad w^2)
    sandVx[i] = (sandVx[i] + fx * drive * 0.08) * damping;
    sandVy[i] = (sandVy[i] + fy * drive * 0.08) * damping;

    sandX[i] += sandVx[i] * dtSec * 15;
    sandY[i] += sandVy[i] * dtSec * 15;

    // Plate edge bounce constraints [-0.47, +0.47]
    if (sandX[i] < -0.47) { sandX[i] = -0.47; sandVx[i] *= -0.5; }
    if (sandX[i] > 0.47) { sandX[i] = 0.47; sandVx[i] *= -0.5; }
    if (sandY[i] < -0.47) { sandY[i] = -0.47; sandVy[i] *= -0.5; }
    if (sandY[i] > 0.47) { sandY[i] = 0.47; sandVy[i] *= -0.5; }
  }

  meanVibrationRms = Math.min(1.0, (totalAmp / NUM_SAND_GRAINS) * 0.8);

  // Step clock: evaluate probe sand accumulation
  stepTimerAcc += dtMs * speedMult;
  const stepInterval = 140;

  if (stepTimerAcc >= stepInterval) {
    stepTimerAcc = 0;

    // Reset probe densities
    for (let p = 0; p < MAX_PROBES; p++) {
      probes[p].prevDensity = probes[p].density;
      probes[p].density = 0;
    }

    // Count sand grains near each probe
    const captureRadiusSq = 0.08 * 0.08;
    for (let i = 0; i < NUM_SAND_GRAINS; i++) {
      const sx = sandX[i];
      const sy = sandY[i];

      for (let p = 0; p < MAX_PROBES; p++) {
        const dx = sx - probes[p].x;
        const dy = sy - probes[p].y;
        if (dx * dx + dy * dy < captureRadiusSq) {
          probes[p].density++;
        }
      }
    }

    // Trigger voices for probes with high sand grain accumulation or nodal density shifts
    if (isChladniPlaying) {
      for (let p = 0; p < MAX_PROBES; p++) {
        const pr = probes[p];
        const densityDiff = pr.density - pr.prevDensity;

        // Trigger if density is high and growing
        if (pr.density >= 6 && densityDiff >= 1) {
          const note = getProbeNote(p);
          const vel = Math.max(50, Math.min(127, Math.round(70 + Math.min(1.0, pr.density / 20) * 50)));
          const durMs = Math.round(180 + pr.octave * 40);

          playVoice(`chladni_${p}`, note, vel, durMs);
          pr.pulseAnim = 1.0;
        }
      }
    }
  }

  // Probe pulse animation decay
  for (let p = 0; p < MAX_PROBES; p++) {
    if (probes[p].pulseAnim > 0.01) {
      probes[p].pulseAnim *= 0.88;
    } else {
      probes[p].pulseAnim = 0;
    }
  }

  // Continuous Timbre Modulation via Plate Vibrational Energy: dispatch CC #74 Brightness
  dispatchTimbreCc(meanVibrationRms, 0.5, 200);
}

/**
 * Render Plate, Nodal Sand Particles, and Hydrophone Probes onto Canvas.
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

  // Plate dimensions: centered square
  const plateDim = Math.min(w * 0.75, h - 32);
  const plateX = (w * 0.5) - (plateDim * 0.5);
  const plateY = (h * 0.5) - (plateDim * 0.5);

  // Square plate base surface
  ctx.fillStyle = colorPanel2;
  ctx.fillRect(plateX, plateY, plateDim, plateDim);

  ctx.strokeStyle = colorLineFocus;
  ctx.lineWidth = 1.5;
  ctx.strokeRect(plateX, plateY, plateDim, plateDim);

  // Center anchor
  ctx.strokeStyle = colorLine;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(plateX + plateDim * 0.5, plateY + plateDim * 0.5, 3, 0, Math.PI * 2);
  ctx.stroke();

  // Helper coordinate mapper: plate [-0.5, 0.5] -> screen [plateX, plateX + plateDim]
  function mapX(x) { return plateX + (x + 0.5) * plateDim; }
  function mapY(y) { return plateY + (y + 0.5) * plateDim; }

  // Draw Sand Particles
  ctx.fillStyle = colorAccent2;
  for (let i = 0; i < NUM_SAND_GRAINS; i++) {
    const px = mapX(sandX[i]);
    const py = mapY(sandY[i]);
    ctx.fillRect(px - 1, py - 1, 2, 2);
  }

  // Draw 8 Hydrophone Probes
  for (let p = 0; p < MAX_PROBES; p++) {
    const pr = probes[p];
    const px = mapX(pr.x);
    const py = mapY(pr.y);
    const pulse = pr.pulseAnim;

    // Capture radius halo
    ctx.strokeStyle = pulse > 0.1 ? "#ffffff" : colorLine;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(px, py, 14 + pulse * 6, 0, Math.PI * 2);
    ctx.stroke();

    // Probe center disc
    ctx.fillStyle = pulse > 0.1 ? colorOk : colorAccent;
    ctx.beginPath();
    ctx.arc(px, py, 6 + pulse * 2, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(px, py, 6 + pulse * 2, 0, Math.PI * 2);
    ctx.stroke();

    // Probe label & note readout
    const noteName = midiName(getProbeNote(p));
    ctx.font = "bold 9px monospace";
    ctx.fillStyle = pulse > 0.1 ? "#ffffff" : colorFg;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(`P${p + 1}`, px, py - 14);

    ctx.font = "8px monospace";
    ctx.fillStyle = colorDim;
    ctx.fillText(noteName, px, py + 14);
  }

  // Header & status readout
  ctx.font = "9px monospace";
  ctx.fillStyle = colorDim;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillText(`Mode: (${state.chladniM || 2}, ${state.chladniN || 3}) | Vibrational RMS: ${(meanVibrationRms * 100).toFixed(0)}% | Sand: ${NUM_SAND_GRAINS}`, 12, h - 8);
}

/**
 * Generator Function Contract: generateChladniBank(state).
 * Returns a valid bank array of pattern objects for 64-step sync mode.
 */
export function generateChladniBank(stateObj) {
  const seqLen = stateObj?.length || 64;
  const rateIdx = stateObj?.rate !== undefined ? stateObj.rate : 3;

  const steps = [];

  for (let s = 0; s < seqLen; s++) {
    const probeIdx = s % MAX_PROBES;
    const note = getProbeNote(probeIdx);
    const isDownbeat = (s % 8 === 0);

    steps.push({
      note,
      vel: isDownbeat ? 112 : 84,
      notes: [{ note, vel: isDownbeat ? 112 : 84 }],
      gate: 1,
      accent: isDownbeat ? 1 : 0,
      slide: 0,
      pitchMidi: note,
      source: "chladni",
      probeIdx
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
export function isChladniRunning() {
  return isChladniPlaying;
}

export function startChladni() {
  if (isChladniPlaying) return;
  isChladniPlaying = true;
  audio.unlock();
  updatePlayBtnUI();
  status("Chladni Cymatics: Resonant plate excitation active", "ok");
}

export function stopChladni() {
  isChladniPlaying = false;
  releasePolyVoices();
  panicPreview();
  try { audio.allOff(); } catch (_) {}
  updatePlayBtnUI();
  status("Chladni Cymatics: Stopped", "warn");
}

export function toggleChladniRunning() {
  if (isChladniPlaying) stopChladni();
  else startChladni();
}

function updatePlayBtnUI() {
  const btn = document.getElementById("chladni-play-btn");
  if (!btn) return;
  btn.textContent = isChladniPlaying ? "Stop" : "Play";
  btn.className = isChladniPlaying ? "btn btn-err" : "btn btn-ok";
}

/**
 * Model Activation / Deactivation Lifecycle
 */
export function activateChladniModel() {
  setModelGenerator(generateChladniBank);
  setModelStepHandler((stepIdx) => {
    // In SYNC mode: step simulation
    stepSimulation(32);
    renderCanvas();
  });
  setModelTransportHandler({
    start: startChladni,
    stop: stopChladni,
    toggle: toggleChladniRunning,
    isRunning: isChladniRunning
  });

  stopChladni();
  lastFrameTime = performance.now();
  if (!animFrameId) {
    animFrameId = requestAnimationFrame(animationTick);
  }
}

export function deactivateChladniModel() {
  setModelGenerator(null);
  setModelStepHandler(null);
  setModelTransportHandler(null);
  stopChladni();
  if (animFrameId) {
    cancelAnimationFrame(animFrameId);
    animFrameId = null;
  }
}

function animationTick(now) {
  if (getActiveModel() === "chladni") {
    const dt = Math.min(50, now - lastFrameTime);
    lastFrameTime = now;

    if (isChladniPlaying) {
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
  id: "chladni",
  version: 1,
  migrations: {},
  capture: () => ({
    preset: state.chladniPreset || "concentric_cross",
    m: state.chladniM ?? 2,
    n: state.chladniN ?? 3,
    a: state.chladniA ?? 1.0,
    b: state.chladniB ?? 1.0,
    drive: state.chladniDrive ?? 1.5,
    span: state.chladniSpan ?? 2,
    probes: probes.map(p => ({ x: p.x, y: p.y, octave: p.octave }))
  }),
  restore: (data) => {
    if (!data) return;
    if (data.preset) state.chladniPreset = data.preset;
    if (data.m !== undefined) state.chladniM = data.m;
    if (data.n !== undefined) state.chladniN = data.n;
    if (data.a !== undefined) state.chladniA = data.a;
    if (data.b !== undefined) state.chladniB = data.b;
    if (data.drive !== undefined) state.chladniDrive = data.drive;
    if (data.span !== undefined) state.chladniSpan = data.span;

    if (Array.isArray(data.probes)) {
      for (let i = 0; i < Math.min(MAX_PROBES, data.probes.length); i++) {
        if (data.probes[i].x !== undefined) probes[i].x = data.probes[i].x;
        if (data.probes[i].y !== undefined) probes[i].y = data.probes[i].y;
        if (data.probes[i].octave !== undefined) probes[i].octave = data.probes[i].octave;
      }
    }
    renderCanvas();
  }
});

/**
 * Initialize DOM Elements & Interactive Event Listeners.
 */
export function initChladni() {
  container = document.getElementById("model-chladni");
  if (!container) return;

  container.innerHTML = `
    <div class="chladni-workbench" style="display: flex; flex-direction: column; gap: 8px; width: 100%;">
      <!-- Controls Toolbar -->
      <div class="chladni-toolbar" style="display: flex; flex-wrap: wrap; align-items: center; gap: 10px; background: var(--panel2); padding: 8px 12px; border: 1px solid var(--line);">
        <div id="chladni-preset-ctrl"></div>
        <div id="chladni-m-ctrl"></div>
        <div id="chladni-n-ctrl"></div>
        <div id="chladni-drive-ctrl"></div>
        <div id="chladni-span-ctrl"></div>
        <div style="display: flex; gap: 6px; margin-left: auto;">
          <button id="chladni-bow-btn" class="btn btn-accent" title="Acoustic bow impulse excitation">Violin Bow</button>
          <button id="chladni-scatter-btn" class="btn" title="Scatter sand grains uniformly over plate">Scatter Sand</button>
          <button id="chladni-reset-btn" class="btn" title="Reset plate to preset baseline">Reset</button>
          <button id="chladni-play-btn" class="btn btn-ok" title="Start/Stop Cymatics Simulation">Play</button>
        </div>
      </div>

      <!-- Interactive Square Plate Canvas -->
      <div class="chladni-canvas-wrap" style="position: relative; width: 100%; border: 1px solid var(--line); background: var(--panel);">
        <canvas id="chladni-canvas" width="680" height="340" style="display: block; width: 100%; height: auto; cursor: crosshair;"></canvas>
      </div>
    </div>
  `;

  canvas = document.getElementById("chladni-canvas");
  if (canvas) {
    ctx = canvas.getContext("2d");
  }

  // Preset Dropdown
  const presetCtrl = document.getElementById("chladni-preset-ctrl");
  if (presetCtrl) {
    presetCtrl.appendChild(
      dropdown({
        label: "Figure",
        options: CHLADNI_PRESETS.map(p => ({ value: p.id, label: p.name })),
        value: state.chladniPreset || "concentric_cross",
        onChange: (val) => {
          state.chladniPreset = val;
          initChladniPreset(val);
          renderCanvas();
        }
      })
    );
  }

  // Mode M Knob
  const mCtrl = document.getElementById("chladni-m-ctrl");
  if (mCtrl) {
    mCtrl.appendChild(
      knob({
        label: "Mode M",
        min: 1,
        max: 7,
        step: 1,
        value: Number(state.chladniM ?? 2),
        onChange: (v) => {
          state.chladniM = v;
          renderCanvas();
        }
      })
    );
  }

  // Mode N Knob
  const nCtrl = document.getElementById("chladni-n-ctrl");
  if (nCtrl) {
    nCtrl.appendChild(
      knob({
        label: "Mode N",
        min: 1,
        max: 7,
        step: 1,
        value: Number(state.chladniN ?? 3),
        onChange: (v) => {
          state.chladniN = v;
          renderCanvas();
        }
      })
    );
  }

  // Drive Knob
  const driveCtrl = document.getElementById("chladni-drive-ctrl");
  if (driveCtrl) {
    driveCtrl.appendChild(
      knob({
        label: "Drive",
        min: 0.2,
        max: 3.5,
        step: 0.1,
        value: Number(state.chladniDrive ?? 1.5),
        onChange: (v) => {
          state.chladniDrive = v;
          renderCanvas();
        }
      })
    );
  }

  // Pitch Span Knob
  const spanCtrl = document.getElementById("chladni-span-ctrl");
  if (spanCtrl) {
    spanCtrl.appendChild(
      knob({
        label: "Span",
        min: 1,
        max: 4,
        step: 1,
        value: Number(state.chladniSpan ?? 2),
        unit: "oct",
        onChange: (v) => {
          state.chladniSpan = v;
          renderCanvas();
        }
      })
    );
  }

  // Buttons
  const bowBtn = document.getElementById("chladni-bow-btn");
  if (bowBtn) {
    bowBtn.addEventListener("click", () => {
      bowImpulse(0, 0, 1.5);
    });
  }

  const scatterBtn = document.getElementById("chladni-scatter-btn");
  if (scatterBtn) {
    scatterBtn.addEventListener("click", () => {
      scatterSandGrains();
      status("Scattered sand grains across the plate");
      renderCanvas();
    });
  }

  const resetBtn = document.getElementById("chladni-reset-btn");
  if (resetBtn) {
    resetBtn.addEventListener("click", () => {
      initChladniPreset(state.chladniPreset || "concentric_cross");
      status("Reset Chladni plate to preset baseline");
      renderCanvas();
    });
  }

  const playBtn = document.getElementById("chladni-play-btn");
  if (playBtn) {
    playBtn.addEventListener("click", () => {
      toggleChladniRunning();
    });
  }

  setupCanvasInteraction();
  initChladniPreset(state.chladniPreset || "concentric_cross");
  renderCanvas();
}

/**
 * Direct Manipulation: Drag hydrophone pickup probes or click/drag to bow plate.
 */
function setupCanvasInteraction() {
  if (!canvas) return;

  function getPlatePos(e) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const mx = (e.clientX - rect.left) * scaleX;
    const my = (e.clientY - rect.top) * scaleY;

    const plateDim = Math.min(canvas.width * 0.75, canvas.height - 32);
    const plateX = (canvas.width * 0.5) - (plateDim * 0.5);
    const plateY = (canvas.height * 0.5) - (plateDim * 0.5);

    const normX = (mx - plateX) / plateDim - 0.5;
    const normY = (my - plateY) / plateDim - 0.5;

    return { normX, normY, mx, my, onPlate: (normX >= -0.5 && normX <= 0.5 && normY >= -0.5 && normY <= 0.5) };
  }

  canvas.addEventListener("mousedown", (e) => {
    const { normX, normY, onPlate } = getPlatePos(e);
    if (!onPlate) return;

    // Check if clicked on a probe
    for (let p = 0; p < MAX_PROBES; p++) {
      const dx = probes[p].x - normX;
      const dy = probes[p].y - normY;
      if (dx * dx + dy * dy < 0.003) {
        draggedProbe = p;
        status(`Dragging Probe P${p + 1}`);
        return;
      }
    }

    // Bow excitation impulse at click location
    bowImpulse(normX, normY, 1.2);
    renderCanvas();
  });

  canvas.addEventListener("mousemove", (e) => {
    if (draggedProbe >= 0) {
      const { normX, normY } = getPlatePos(e);
      probes[draggedProbe].x = Math.max(-0.46, Math.min(0.46, normX));
      probes[draggedProbe].y = Math.max(-0.46, Math.min(0.46, normY));
      renderCanvas();
    }
  });

  window.addEventListener("mouseup", () => {
    draggedProbe = -1;
  });
}
