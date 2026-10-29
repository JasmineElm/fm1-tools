// reaction_diffusion.js — Gray-Scott Reaction-Diffusion Turing Morphogenesis Sequencer for FM-1 Pulses.
// Chemical morphogenesis, non-linear partial differential equations, and spatial resonance probes.
//
// Generative Architecture:
// 1. Gray-Scott Non-Linear PDE Simulation:
//    - Two chemical species U (substrate) and V (autocatalyst) diffuse and react on a 2D lattice.
//    - dU/dt = Du * laplacian(U) - U * V^2 + F * (1 - U)
//    - dV/dt = Dv * laplacian(V) + U * V^2 - (F + k) * V
// 2. Turing Pattern Regimes:
//    - Coral Labyrinths, Mitosis Dividing Spots, Solitonic Pulsing Waves, Spiral Chaos, and Holes.
// 3. Spatial Pickups / Resonance Probes:
//    - Up to 8 interactive pickup sensors positioned across the chemical substrate.
//    - Strictly complies with the M-VAVE FM-1's 8-voice hardware polyphony ceiling.
//    - Wavefront and spot crossings trigger scale-quantized notes via js/poly.js.
// 4. Scale Quantization & Pitch Mapping:
//    - Probe X coordinate maps to scale degree; Y coordinate maps to octave shift via js/scale.js.
// 5. Continuous Timbre CC #74 Modulation:
//    - Global morphogen entropy and active reaction coverage modulate CC #74 via dispatchTimbreCc().
// 6. Direct Manipulation Flat Workbench Visualizer:
//    - Click and drag to inoculate/paint chemical seeds into the petri dish;
//    - Drag probe sensors to reposition listening points across morphogenetic zones.
// 7. Strict 8-Voice Hardware Polyphony via js/poly.js.
// 8. Zero GC Churn: Pre-allocated TypedArrays (Float32Array, Uint8Array).

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
import { fillPerlin2D } from "./perlin.js";

// ---- Grid Dimensions & Pre-allocated TypedArrays (Zero GC Churn) ----
export const GRID_W = 96;
export const GRID_H = 64;
export const MAX_PROBES = 8; // Strictly 8 voices for M-VAVE FM-1 hardware

export const gridU = new Float32Array(GRID_W * GRID_H);
export const gridV = new Float32Array(GRID_W * GRID_H);
const nextU = new Float32Array(GRID_W * GRID_H);
const nextV = new Float32Array(GRID_W * GRID_H);

// Pre-allocated Probe Sensors
export const probes = [];
for (let i = 0; i < MAX_PROBES; i++) {
  probes.push({
    active: true,
    x: 0,
    y: 0,
    lastVal: 0,
    cooldown: 0,
    pulseAnim: 0
  });
}

// Classical Gray-Scott Presets
export const RD_PRESETS = [
  { id: "coral", name: "Coral Labyrinths", F: 0.0545, k: 0.0620, Du: 0.19, Dv: 0.09, desc: "Dense winding labyrinthine corridors and brain-coral convolutions" },
  { id: "mitosis", name: "Mitosis Spots", F: 0.0367, k: 0.0649, Du: 0.16, Dv: 0.08, desc: "Self-replicating biological spots dividing and multiplying across the substrate" },
  { id: "solitons", name: "Solitonic Waves", F: 0.0140, k: 0.0540, Du: 0.20, Dv: 0.10, desc: "Expanding solitary rings and colliding wavefront pulses" },
  { id: "spirals", name: "Spiral Chaos", F: 0.0180, k: 0.0510, Du: 0.19, Dv: 0.09, desc: "Turbulent rotating chemical rotors and chaotic vortex waves" },
  { id: "holes", name: "Inverted Holes", F: 0.0390, k: 0.0580, Du: 0.16, Dv: 0.08, desc: "Negative honeycomb pores and oscillating vesicular chambers" }
];

// Runtime State
let isRdPlaying = false;
let animFrameId = null;
let lastFrameTime = 0;
let activeMorphogenMetric = 0;

// UI & Canvas References
let container = null;
let canvas = null;
let ctx = null;
let dragProbeIdx = -1;
let isPainting = false;

/**
 * Initialize Probe Sensor coordinates in a structured arrangement.
 */
export function initProbes() {
  // Distribute 8 probes evenly across the grid quadrants and center
  const layout = [
    { x: 24, y: 16 }, // Top-Left
    { x: 48, y: 16 }, // Top-Center
    { x: 72, y: 16 }, // Top-Right
    { x: 30, y: 32 }, // Mid-Left
    { x: 66, y: 32 }, // Mid-Right
    { x: 24, y: 48 }, // Bottom-Left
    { x: 48, y: 48 }, // Bottom-Center
    { x: 72, y: 48 }  // Bottom-Right
  ];

  for (let i = 0; i < MAX_PROBES; i++) {
    probes[i].active = true;
    probes[i].x = layout[i].x;
    probes[i].y = layout[i].y;
    probes[i].lastVal = 0;
    probes[i].cooldown = 0;
    probes[i].pulseAnim = 0;
  }
}

/**
 * Seed the chemical field with initial substrate U=1 and central morphogen droplets of V.
 */
export function seedChemicalField(type = "multi_seed") {
  // Clear entire substrate: U = 1.0, V = 0.0
  gridU.fill(1.0);
  gridV.fill(0.0);
  nextU.fill(1.0);
  nextV.fill(0.0);

  if (type === "multi_seed") {
    // Inoculate multiple seed clusters near probe sensors
    for (let p = 0; p < MAX_PROBES; p++) {
      if (probes[p].active) {
        inoculateDroplet(probes[p].x, probes[p].y, 4);
      }
    }
  } else if (type === "center") {
    inoculateDroplet(GRID_W / 2, GRID_H / 2, 6);
  } else if (type === "random_droplets") {
    for (let i = 0; i < 12; i++) {
      const rx = Math.floor(Math.random() * (GRID_W - 10)) + 5;
      const ry = Math.floor(Math.random() * (GRID_H - 10)) + 5;
      inoculateDroplet(rx, ry, Math.floor(Math.random() * 3) + 2);
    }
  }
}

/**
 * Drop or paint an autocatalyst V droplet into the chemical grid.
 */
export function inoculateDroplet(cx, cy, radius = 4) {
  const r2 = radius * radius;
  const minX = Math.max(1, Math.floor(cx - radius));
  const maxX = Math.min(GRID_W - 2, Math.ceil(cx + radius));
  const minY = Math.max(1, Math.floor(cy - radius));
  const maxY = Math.min(GRID_H - 2, Math.ceil(cy + radius));

  for (let y = minY; y <= maxY; y++) {
    const rowOffset = y * GRID_W;
    for (let x = minX; x <= maxX; x++) {
      const dist2 = (x - cx) * (x - cx) + (y - cy) * (y - cy);
      if (dist2 <= r2) {
        const idx = rowOffset + x;
        gridU[idx] = 0.5 + (Math.random() - 0.5) * 0.05;
        gridV[idx] = 0.45 + (Math.random() - 0.5) * 0.05;
      }
    }
  }
}

/**
 * Randomize Gray-Scott chemical substrate using 2D Perlin noise.
 * Generates organic morphogen clusters and sets complementary inhibitor field.
 */
export function randomizeReactionDiffusion() {
  fillPerlin2D(gridV, GRID_W, GRID_H, {
    scale: 0.08,
    octaves: 3,
    persistence: 0.5,
    lacunarity: 2.0,
    min: 0.0,
    max: 0.48,
    threshold: 0.45,
    thresholdMin: 0.0,
    power: 1.2
  });

  for (let i = 0; i < GRID_W * GRID_H; i++) {
    const v = gridV[i];
    if (v > 0) {
      gridU[i] = Math.max(0.15, 1.0 - v * 1.3);
    } else {
      gridU[i] = 1.0;
    }
  }

  nextU.set(gridU);
  nextV.set(gridV);
  status("Randomised Gray-Scott chemical substrate with Perlin noise", "ok");
  if (canvas) renderCanvas();
}

/**
 * Maps probe sensor spatial position to a scale-quantized pitch.
 */
export function getProbeNote(probe) {
  const intervals = getActiveScaleIntervals();
  const root = getRootMidi();
  const span = Math.min(4, Math.max(1, Number(state.rdSpan ?? 2)));

  // X coordinate maps to scale degrees
  const normX = Math.max(0, Math.min(1, probe.x / GRID_W));
  const numDeg = intervals.length || 7;
  const deg = Math.floor(normX * numDeg) % numDeg;

  // Y coordinate maps to octave shift (higher position = higher pitch)
  const normY = Math.max(0, Math.min(1, 1 - (probe.y / GRID_H)));
  const oct = Math.min(span, Math.floor(normY * (span + 1)));

  const rawMidi = root + oct * 12 + (intervals[deg] ?? 0);
  return quantize(rawMidi, intervals, root);
}

/**
 * Execute one numerical integration step of the Gray-Scott reaction-diffusion PDE.
 */
export function stepSimulation(dtMs = 16) {
  const speedMult = Math.max(0.1, Number(state.modelSpeed ?? 1.0));
  const numSubsteps = Math.max(1, Math.min(8, Math.round(3 * speedMult)));

  // Retrieve parameters
  const currentPreset = RD_PRESETS.find(p => p.id === (state.rdPreset || "coral")) || RD_PRESETS[0];
  const F = Number(state.rdFeed ?? currentPreset.F);
  const k = Number(state.rdKill ?? currentPreset.k);
  const Du = Number(state.rdDu ?? currentPreset.Du);
  const Dv = Number(state.rdDv ?? currentPreset.Dv);
  const threshold = Math.max(0.1, Math.min(0.8, Number(state.rdThreshold ?? 0.28)));

  const dt = 1.0;

  // Perform multiple numerical sub-steps per frame for rapid chemical morphogenesis
  for (let step = 0; step < numSubsteps; step++) {
    for (let y = 1; y < GRID_H - 1; y++) {
      const rowOffset = y * GRID_W;
      const upOffset = (y - 1) * GRID_W;
      const downOffset = (y + 1) * GRID_W;

      for (let x = 1; x < GRID_W - 1; x++) {
        const idx = rowOffset + x;
        const u = gridU[idx];
        const v = gridV[idx];

        // 5-point discrete Laplacian operator
        const lapU = gridU[idx - 1] + gridU[idx + 1] + gridU[upOffset + x] + gridU[downOffset + x] - 4 * u;
        const lapV = gridV[idx - 1] + gridV[idx + 1] + gridV[upOffset + x] + gridV[downOffset + x] - 4 * v;

        // Reaction term: U * V^2
        const uvv = u * v * v;

        // Gray-Scott update formulas:
        // dU/dt = Du * lapU - uvv + F * (1 - u)
        // dV/dt = Dv * lapV + uvv - (F + k) * v
        const nU = u + (Du * lapU - uvv + F * (1 - u)) * dt;
        const nV = v + (Dv * lapV + uvv - (F + k) * v) * dt;

        nextU[idx] = Math.max(0, Math.min(1, nU));
        nextV[idx] = Math.max(0, Math.min(1, nV));
      }
    }

    // Swap buffers
    gridU.set(nextU);
    gridV.set(nextV);
  }

  // Probe Sensors Evaluation & Note Triggers
  let totalActiveV = 0;

  for (let p = 0; p < MAX_PROBES; p++) {
    const probe = probes[p];
    if (!probe.active) continue;

    const px = Math.max(1, Math.min(GRID_W - 2, Math.round(probe.x)));
    const py = Math.max(1, Math.min(GRID_H - 2, Math.round(probe.y)));
    const idx = py * GRID_W + px;
    const currentVal = gridV[idx];
    totalActiveV += currentVal;

    // Cooldown decay
    if (probe.cooldown > 0) {
      probe.cooldown -= (dtMs / 16) * speedMult;
    }

    // Pulse animation decay
    if (probe.pulseAnim > 0.01) {
      probe.pulseAnim *= 0.88;
    } else {
      probe.pulseAnim = 0;
    }

    // Threshold crossing check: rising edge of morphogen V concentration!
    if (currentVal >= threshold && probe.lastVal < threshold && probe.cooldown <= 0) {
      probe.cooldown = 14; // Refractory delay
      probe.pulseAnim = 1.0;

      if (isRdPlaying) {
        const note = getProbeNote(probe);
        const intensity = Math.min(1.0, currentVal / 0.6);
        const vel = Math.max(45, Math.min(127, Math.round(80 + intensity * 40)));
        const durMs = Math.round(200 + intensity * 240);

        // Dispatch voice strictly through poly.js manager (voice slot p, 0 to 7)
        playVoice(`rd_${p}`, note, vel, durMs);
      }
    }

    probe.lastVal = currentVal;
  }

  // Continuous Timbre Modulation (CC #74) driven by active chemical morphogen level
  const avgV = totalActiveV / MAX_PROBES;
  activeMorphogenMetric = Math.min(1.0, avgV / 0.4);
  dispatchTimbreCc(activeMorphogenMetric, 0.5, 200);
}

/**
 * Render Gray-Scott chemical substrate and probe sensors onto the canvas.
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

  const scaleX = w / GRID_W;
  const scaleY = h / GRID_H;

  // 1. Draw Chemical Substrate Morphogen Patterns
  for (let y = 0; y < GRID_H; y += 2) {
    const rowOffset = y * GRID_W;
    for (let x = 0; x < GRID_W; x += 2) {
      const v = gridV[rowOffset + x];
      if (v > 0.08) {
        const intensity = Math.min(1.0, v / 0.5);
        ctx.fillStyle = colorAccent;
        ctx.globalAlpha = intensity * 0.75;
        ctx.fillRect(x * scaleX, y * scaleY, scaleX * 2, scaleY * 2);
      }
    }
  }
  ctx.globalAlpha = 1.0;

  // 2. Draw Spatial Pickup Probe Sensors
  for (let p = 0; p < MAX_PROBES; p++) {
    const probe = probes[p];
    if (!probe.active) continue;

    const px = probe.x * scaleX;
    const py = probe.y * scaleY;
    const pulse = probe.pulseAnim;

    // Resonant pulse excitation ring on note strike
    if (pulse > 0.05) {
      ctx.strokeStyle = colorOk;
      ctx.lineWidth = 1 + pulse * 2.5;
      ctx.beginPath();
      ctx.arc(px, py, 10 + (1.0 - pulse) * 16, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Outer probe sensor body
    ctx.fillStyle = pulse > 0.05 ? colorOk : colorPanel2;
    ctx.strokeStyle = pulse > 0.05 ? colorFg : colorLineFocus;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(px, py, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Inner probe crosshair
    ctx.strokeStyle = colorAccent2;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(px - 5, py);
    ctx.lineTo(px + 5, py);
    ctx.moveTo(px, py - 5);
    ctx.lineTo(px, py + 5);
    ctx.stroke();

    // Note Name and Voice ID labels
    const noteMidi = getProbeNote(probe);
    const label = `${midiName(noteMidi)}`;
    ctx.font = "bold 9px monospace";
    ctx.fillStyle = pulse > 0.05 ? colorOk : colorFg;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, px, py - 13);

    ctx.font = "8px monospace";
    ctx.fillStyle = colorDim;
    ctx.fillText(`P${p + 1}`, px, py + 13);
  }

  // 3. Header Status Bar
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.font = "10px monospace";
  ctx.fillStyle = colorDim;
  ctx.fillText("GRAY-SCOTT REACTION-DIFFUSION · TURING CHEMICAL MORPHOGENESIS", 12, 16);

  ctx.textAlign = "right";
  ctx.fillText(`ACTIVE PROBES: ${MAX_PROBES}/8 | REACTION ENTROPY: ${(activeMorphogenMetric * 100).toFixed(0)}%`, w - 12, 16);
}

/**
 * Main animation tick.
 */
function animationTick(now) {
  if (!lastFrameTime) lastFrameTime = now;
  const dt = Math.min(100, now - lastFrameTime);
  lastFrameTime = now;

  if (isRdPlaying) {
    stepSimulation(dt);
  }

  renderCanvas();
  if (typeof requestAnimationFrame === "function") {
    animFrameId = requestAnimationFrame(animationTick);
  }
}

/**
 * Direct canvas interaction: Drag probe sensors or paint chemical droplets.
 */
function setupCanvasInteraction() {
  if (!canvas) return;

  canvas.style.cursor = "crosshair";

  function getCanvasCoords(e) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = GRID_W / rect.width;
    const scaleY = GRID_H / rect.height;
    return {
      gx: (e.clientX - rect.left) * scaleX,
      gy: (e.clientY - rect.top) * scaleY
    };
  }

  canvas.addEventListener("mousedown", (e) => {
    const { gx, gy } = getCanvasCoords(e);

    // Check if clicked near an existing probe sensor
    dragProbeIdx = -1;
    for (let p = 0; p < MAX_PROBES; p++) {
      const probe = probes[p];
      if (!probe.active) continue;
      const dist = Math.hypot(probe.x - gx, probe.y - gy);
      if (dist <= 6.0) {
        dragProbeIdx = p;
        break;
      }
    }

    if (dragProbeIdx === -1) {
      // Paint chemical droplet into the substrate!
      isPainting = true;
      inoculateDroplet(gx, gy, 5);
      renderCanvas();
    }
  });

  window.addEventListener("mousemove", (e) => {
    if (dragProbeIdx !== -1) {
      const { gx, gy } = getCanvasCoords(e);
      probes[dragProbeIdx].x = Math.max(2, Math.min(GRID_W - 3, Math.round(gx)));
      probes[dragProbeIdx].y = Math.max(2, Math.min(GRID_H - 3, Math.round(gy)));
      renderCanvas();
    } else if (isPainting && canvas) {
      const { gx, gy } = getCanvasCoords(e);
      inoculateDroplet(gx, gy, 4);
      renderCanvas();
    }
  });

  window.addEventListener("mouseup", () => {
    if (dragProbeIdx !== -1) {
      status(`Repositioned Pickup Probe P${dragProbeIdx + 1}`);
      dragProbeIdx = -1;
    }
    isPainting = false;
  });
}

/**
 * Generator Function Contract: generateReactionDiffusionBank(state).
 * Returns a valid bank array of pattern objects for 64-step sync mode.
 */
export function generateReactionDiffusionBank(stateObj) {
  const seqLen = stateObj?.length || 64;
  const rateIdx = stateObj?.rate !== undefined ? stateObj.rate : 3;

  const steps = [];
  const activeProbes = probes.filter(p => p.active);

  for (let s = 0; s < seqLen; s++) {
    if (activeProbes.length === 0) {
      steps.push({
        note: 60,
        vel: 80,
        notes: [],
        gate: 0,
        accent: 0,
        slide: 0,
        pitchMidi: 60,
        source: "reaction_diffusion"
      });
      continue;
    }

    const probe = activeProbes[s % activeProbes.length];
    const note = getProbeNote(probe);
    const isDownbeat = (s % 8 === 0);
    const vel = isDownbeat ? 112 : 86;

    steps.push({
      note,
      vel,
      notes: [{ note, vel }],
      gate: 1,
      accent: isDownbeat ? 1 : 0,
      slide: 0,
      pitchMidi: note,
      source: "reaction_diffusion",
      probeIdx: s % activeProbes.length
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
export function isReactionDiffusionRunning() {
  return isRdPlaying;
}

export function startReactionDiffusion() {
  if (isRdPlaying) return;
  isRdPlaying = true;
  audio.unlock();
  updatePlayBtnUI();
  status("Reaction-Diffusion: Turing morphogenesis · Transport active", "ok");
}

export function stopReactionDiffusion() {
  isRdPlaying = false;
  releasePolyVoices();
  updatePlayBtnUI();
  status("Reaction-Diffusion: Stopped", "warn");
}

export function toggleReactionDiffusionRunning() {
  if (isRdPlaying) stopReactionDiffusion();
  else startReactionDiffusion();
}

function updatePlayBtnUI() {
  const btn = document.getElementById("rd-play-btn");
  if (!btn) return;
  btn.textContent = isRdPlaying ? "Stop" : "Play";
  btn.className = isRdPlaying ? "btn btn-err" : "btn btn-ok";
}

/**
 * Model Activation / Deactivation Lifecycle
 */
export function activateReactionDiffusionModel() {
  setModelGenerator(generateReactionDiffusionBank);
  setModelRandomizer(randomizeReactionDiffusion);
  setModelStepHandler((stepIdx) => {
    // SYNC mode step: execute simulation pulses
    stepSimulation(32);
    renderCanvas();
  });
  setModelTransportHandler({
    start: startReactionDiffusion,
    stop: stopReactionDiffusion,
    toggle: toggleReactionDiffusionRunning,
    isRunning: isReactionDiffusionRunning
  });

  lastFrameTime = performance.now();
  if (!animFrameId && typeof requestAnimationFrame === "function") {
    animFrameId = requestAnimationFrame(animationTick);
  }
}

export function deactivateReactionDiffusionModel() {
  setModelGenerator(null);
  setModelRandomizer(null);
  setModelStepHandler(null);
  setModelTransportHandler(null);
  isRdPlaying = false;
  releasePolyVoices();

  if (animFrameId && typeof cancelAnimationFrame === "function") {
    cancelAnimationFrame(animFrameId);
    animFrameId = null;
  }
}

/**
 * Initialize the Reaction-Diffusion UI enclosure.
 */
export function initReactionDiffusion() {
  container = document.getElementById("model-reaction_diffusion");
  if (!container) return;

  container.innerHTML = `
    <div class="rd-enclosure">
      <!-- Top Control Bar -->
      <div class="rd-controls" style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-bottom: 8px;">
        <button id="rd-play-btn" class="btn btn-ok" style="min-width: 60px;" title="Start/Stop reaction-diffusion simulation engine">Play</button>
        <button id="rd-rnd-btn" class="btn" title="Randomise chemical substrate with Perlin noise">RND</button>
        <button id="rd-seed-btn" class="btn" title="Re-inoculate chemical seeds">Re-Seed</button>
        <button id="rd-clear-btn" class="btn" title="Clear substrate to pure U">Clear</button>

        <label style="font-size: 11px; color: var(--dim); display: flex; align-items: center; gap: 4px;" title="Turing morphogenesis preset: chemical reaction parameters dictating coral labyrinth, spot mitosis, soliton wave, or spiral patterns">
          Preset:
          <select id="rd-preset-select" class="select-field" style="padding: 2px 4px; font-size: 11px;" title="Turing morphogenesis preset: chemical reaction parameters dictating coral labyrinth, spot mitosis, soliton wave, or spiral patterns">
            ${RD_PRESETS.map(p => `<option value="${p.id}" ${p.id === (state.rdPreset || "coral") ? "selected" : ""}>${p.name}</option>`).join("")}
          </select>
        </label>

        <label style="font-size: 11px; color: var(--dim); display: flex; align-items: center; gap: 4px;" title="Chemical Feed Rate (F): Rate at which nutrient U is continuously supplied, determining pattern density and corridor thickness">
          Feed:
          <input type="range" id="rd-feed" min="0.010" max="0.080" step="0.001" value="${state.rdFeed ?? 0.054}" style="width: 70px;" title="Chemical Feed Rate (F): Rate at which nutrient U is continuously supplied, determining pattern density and corridor thickness">
        </label>

        <label style="font-size: 11px; color: var(--dim); display: flex; align-items: center; gap: 4px;" title="Chemical Kill Rate (k): Rate at which morphogen V decays or converts to inert products, controlling spot stability vs extinction">
          Kill:
          <input type="range" id="rd-kill" min="0.045" max="0.070" step="0.001" value="${state.rdKill ?? 0.062}" style="width: 70px;" title="Chemical Kill Rate (k): Rate at which morphogen V decays or converts to inert products, controlling spot stability vs extinction">
        </label>

        <label style="font-size: 11px; color: var(--dim); display: flex; align-items: center; gap: 4px;" title="Activation Threshold: Concentration of morphogen V required at a probe sensor to trigger a note pulse">
          Thresh:
          <input type="range" id="rd-thresh" min="0.15" max="0.55" step="0.02" value="${state.rdThreshold ?? 0.28}" style="width: 70px;" title="Activation Threshold: Concentration of morphogen V required at a probe sensor to trigger a note pulse">
        </label>

        <label style="font-size: 11px; color: var(--dim); display: flex; align-items: center; gap: 4px;" title="Pitch Octave Span: Pitch range across octaves mapped vertically across the chemical substrate">
          Span:
          <input type="range" id="rd-span" min="1" max="4" step="1" value="${state.rdSpan ?? 2}" style="width: 50px;" title="Pitch Octave Span: Pitch range across octaves mapped vertically across the chemical substrate">
        </label>
      </div>

      <!-- Canvas Substrate -->
      <div style="position: relative; width: 100%; border: 1px solid var(--line); background: var(--panel);">
        <canvas id="rd-canvas" width="800" height="420" style="width: 100%; height: auto; display: block;"></canvas>
      </div>
      <div style="font-size: 10px; color: var(--dim); margin-top: 4px; display: flex; justify-content: space-between;">
        <span>Direct Manipulation: Click/drag empty space to paint morphogen V seeds · Drag probe sensors P1–P8 to reposition</span>
        <span>Gray-Scott Reaction-Diffusion PDE Engine · 8 Hardware Polyphony Ceiling</span>
      </div>
    </div>
  `;

  canvas = document.getElementById("rd-canvas");
  if (canvas) {
    ctx = canvas.getContext("2d");
    setupCanvasInteraction();
  }

  // Hook buttons
  const playBtn = document.getElementById("rd-play-btn");
  if (playBtn) playBtn.addEventListener("click", toggleReactionDiffusionRunning);

  const rndBtn = document.getElementById("rd-rnd-btn");
  if (rndBtn) rndBtn.addEventListener("click", () => {
    randomizeReactionDiffusion();
  });

  const seedBtn = document.getElementById("rd-seed-btn");
  if (seedBtn) seedBtn.addEventListener("click", () => {
    seedChemicalField("multi_seed");
    renderCanvas();
    status("Re-seeded Gray-Scott chemical substrate");
  });

  const clearBtn = document.getElementById("rd-clear-btn");
  if (clearBtn) clearBtn.addEventListener("click", () => {
    gridU.fill(1.0);
    gridV.fill(0.0);
    renderCanvas();
    status("Cleared chemical substrate to pure U");
  });

  setModelRandomizer(randomizeReactionDiffusion);

  const presetSelect = document.getElementById("rd-preset-select");
  if (presetSelect) {
    presetSelect.addEventListener("change", (e) => {
      const preset = RD_PRESETS.find(p => p.id === e.target.value);
      if (preset) {
        setState({
          rdPreset: preset.id,
          rdFeed: preset.F,
          rdKill: preset.k,
          rdDu: preset.Du,
          rdDv: preset.Dv
        });
        const feedEl = document.getElementById("rd-feed");
        const killEl = document.getElementById("rd-kill");
        if (feedEl) feedEl.value = preset.F;
        if (killEl) killEl.value = preset.k;
        seedChemicalField("multi_seed");
        renderCanvas();
        status(`Loaded Turing Preset: ${preset.name}`);
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

  bindSlider("rd-feed", "rdFeed");
  bindSlider("rd-kill", "rdKill");
  bindSlider("rd-thresh", "rdThreshold");
  bindSlider("rd-span", "rdSpan");

  // Initial layout and seeding
  initProbes();
  seedChemicalField("multi_seed");
  renderCanvas();
}

// ---- Register Snapshot Serialization Contract ----
registerModel({
  id: "reaction_diffusion",
  version: 1,
  migrations: {},
  capture() {
    return {
      preset: state.rdPreset || "coral",
      feed: state.rdFeed ?? 0.0545,
      kill: state.rdKill ?? 0.0620,
      threshold: state.rdThreshold ?? 0.28,
      span: state.rdSpan ?? 2,
      probes: probes.map(p => ({
        active: p.active,
        x: p.x,
        y: p.y
      }))
    };
  },
  restore(data) {
    if (!data) return;
    if (data.preset) setState({ rdPreset: data.preset });
    if (data.feed !== undefined) setState({ rdFeed: data.feed });
    if (data.kill !== undefined) setState({ rdKill: data.kill });
    if (data.threshold !== undefined) setState({ rdThreshold: data.threshold });
    if (data.span !== undefined) setState({ rdSpan: data.span });

    if (Array.isArray(data.probes)) {
      for (let i = 0; i < MAX_PROBES; i++) {
        if (data.probes[i]) {
          probes[i].active = !!data.probes[i].active;
          probes[i].x = data.probes[i].x;
          probes[i].y = data.probes[i].y;
          probes[i].lastVal = 0;
          probes[i].cooldown = 0;
          probes[i].pulseAnim = 0;
        }
      }
    }
    seedChemicalField("multi_seed");
    renderCanvas();
  }
});
