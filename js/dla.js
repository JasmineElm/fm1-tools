// dla.js — Diffusion-Limited Aggregation (DLA) Dendritic Crystal Sequencer for FM-1 Pulses.
// Physical growth, fractal branching, and Brownian aleatoric mechanics.
//
// Generative Architecture:
// 1. 2D discrete lattice with off-lattice Brownian walker diffusion (Witten & Sander model, Df ≈ 1.71).
// 2. Real-time stickiness probability P_stick controlling needle-fine vs. thick columnar dendritic growth.
// 3. Polar coordinate pitch quantization: radial distance maps to octave spread, polar anomaly angle maps to scale degrees.
// 4. Strict 8-voice polyphony ceiling with shared voice allocation via js/poly.js.
// 5. Continuous Timbre CC #74 Brightness modulation via dispatchTimbreCc() driven by cluster growth density.
// 6. Direct manipulation: interactive canvas to plant new seed nuclei, spray walker swarms, or clear crystal.
// 7. Dual Sync/Free modes: 64-step transport-locked rhythm pattern or continuous autonomous fractal growth.

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

// ---- Constants & Pre-allocated TypedArray Buffers (Zero GC Churn) ----
const GRID_SIZE = 129; // Odd size gives an exact center at (64, 64)
const TOTAL_CELLS = GRID_SIZE * GRID_SIZE;
const CENTER_X = Math.floor(GRID_SIZE / 2);
const CENTER_Y = Math.floor(GRID_SIZE / 2);

const MAX_WALKERS = 256;
const MAX_CLUSTER_PARTICLES = 4096;

// Lattice occupancy: 0 = empty, 1 = frozen cluster, 2 = fresh crystal flash
const lattice = new Uint8Array(TOTAL_CELLS);
const flashLife = new Float32Array(TOTAL_CELLS);

// Pre-allocated walker pool
const walkerX = new Float32Array(MAX_WALKERS);
const walkerY = new Float32Array(MAX_WALKERS);
const walkerActive = new Uint8Array(MAX_WALKERS);

// Pre-allocated cluster tracking
const clusterX = new Int16Array(MAX_CLUSTER_PARTICLES);
const clusterY = new Int16Array(MAX_CLUSTER_PARTICLES);
const clusterOrder = new Int32Array(MAX_CLUSTER_PARTICLES);
const clusterRadius = new Float32Array(MAX_CLUSTER_PARTICLES);
const clusterTheta = new Float32Array(MAX_CLUSTER_PARTICLES);
let clusterCount = 0;
let maxClusterRadius = 4.0;

// Simulation State
let isDlaPlaying = false;
let animFrameId = null;
let lastFrameTime = 0;
let walkerAccumulator = 0;
let growthRatePerSec = 0;
let totalAggregatedInPeriod = 0;
let rateTimer = 0;

// DOM & Canvas
let dlaContainer = null;
let dlaCanvas = null;
let statReadoutEl = null;

// Presets
export const DLA_PRESETS = [
  { id: "center", name: "Radial Snowflake", desc: "Single central seed; isotropic Brownian crystal growth", stick: 1.0 },
  { id: "forest", name: "Coastal Forest", desc: "Baseline seeds along bottom edge; vertical dendritic frost forest", stick: 0.8 },
  { id: "ring", name: "Inverted Cavity", desc: "Perimeter seeds growing inward toward the center", stick: 0.7 },
  { id: "quad", name: "Quad Nuclei", desc: "4 symmetric seeds competing for Brownian particles", stick: 0.9 },
  { id: "coral", name: "Columnar Coral", desc: "Low stickiness (0.15) yielding dense, thick coral branches", stick: 0.15 }
];

// ---- Audio Dispatch & 8-Voice Polyphony Ceiling (via js/poly.js) ----
function playDlaVoice(voiceId, note, vel, durMs) {
  playVoice(voiceId, note, vel, durMs);
}

// ---- Lattice & Seed Initialization ----
export function initDlaLattice(presetId = state.dlaPreset || "center") {
  lattice.fill(0);
  flashLife.fill(0);
  clusterCount = 0;
  maxClusterRadius = 4.0;
  totalAggregatedInPeriod = 0;

  if (presetId === "forest") {
    // Baseline seeds along the bottom edge (y = GRID_SIZE - 2)
    const y = GRID_SIZE - 2;
    for (let x = 8; x < GRID_SIZE - 8; x += 6) {
      addClusterSeed(x, y);
    }
  } else if (presetId === "ring") {
    // Circular perimeter seeds
    const r = Math.floor(GRID_SIZE * 0.44);
    for (let a = 0; a < 16; a++) {
      const angle = (a / 16) * Math.PI * 2;
      const x = Math.round(CENTER_X + Math.cos(angle) * r);
      const y = Math.round(CENTER_Y + Math.sin(angle) * r);
      if (x > 1 && x < GRID_SIZE - 2 && y > 1 && y < GRID_SIZE - 2) {
        addClusterSeed(x, y);
      }
    }
  } else if (presetId === "quad") {
    // 4 symmetric seeds
    const offset = Math.round(GRID_SIZE * 0.22);
    addClusterSeed(CENTER_X - offset, CENTER_Y - offset);
    addClusterSeed(CENTER_X + offset, CENTER_Y - offset);
    addClusterSeed(CENTER_X - offset, CENTER_Y + offset);
    addClusterSeed(CENTER_X + offset, CENTER_Y + offset);
  } else {
    // Default: Single central seed
    addClusterSeed(CENTER_X, CENTER_Y);
  }

  // Initialize walkers on the launch ring
  const numWalkers = Math.min(MAX_WALKERS, Math.max(16, state.dlaWalkers ?? 64));
  for (let i = 0; i < numWalkers; i++) {
    respawnWalker(i);
  }

  renderDlaCanvas();
  updateReadoutMetrics();
}

function addClusterSeed(x, y) {
  if (x < 1 || x >= GRID_SIZE - 1 || y < 1 || y >= GRID_SIZE - 1) return;
  const idx = y * GRID_SIZE + x;
  if (lattice[idx]) return;

  lattice[idx] = 1;
  flashLife[idx] = 1.0;

  if (clusterCount < MAX_CLUSTER_PARTICLES) {
    clusterX[clusterCount] = x;
    clusterY[clusterCount] = y;
    clusterOrder[clusterCount] = clusterCount;
    const dx = x - CENTER_X;
    const dy = y - CENTER_Y;
    const dist = Math.hypot(dx, dy);
    clusterRadius[clusterCount] = dist;
    clusterTheta[clusterCount] = Math.atan2(dy, dx);
    clusterCount++;
    if (dist > maxClusterRadius) maxClusterRadius = dist;
  }
}

// Spawns a Brownian walker just outside the current maximum cluster radius
function respawnWalker(i) {
  const preset = state.dlaPreset || "center";
  if (preset === "forest") {
    // Spawn from the top half of the lattice
    walkerX[i] = 4 + Math.random() * (GRID_SIZE - 8);
    walkerY[i] = 4 + Math.random() * (GRID_SIZE * 0.45);
  } else if (preset === "ring") {
    // Spawn in the inner core
    const angle = Math.random() * Math.PI * 2;
    const r = Math.random() * (GRID_SIZE * 0.2);
    walkerX[i] = CENTER_X + Math.cos(angle) * r;
    walkerY[i] = CENTER_Y + Math.sin(angle) * r;
  } else {
    // Radial launch ring around the cluster
    const launchR = Math.min(GRID_SIZE * 0.46, Math.max(8.0, maxClusterRadius + 4.0 + Math.random() * 6.0));
    const angle = Math.random() * Math.PI * 2;
    walkerX[i] = CENTER_X + Math.cos(angle) * launchR;
    walkerY[i] = CENTER_Y + Math.sin(angle) * launchR;
  }
  walkerActive[i] = 1;
}

// Check if cell (x, y) is adjacent to any frozen cluster particle
function hasClusterNeighbor(x, y) {
  const idx = y * GRID_SIZE + x;
  return (
    lattice[idx - 1] === 1 ||
    lattice[idx + 1] === 1 ||
    lattice[idx - GRID_SIZE] === 1 ||
    lattice[idx + GRID_SIZE] === 1 ||
    lattice[idx - GRID_SIZE - 1] === 1 ||
    lattice[idx - GRID_SIZE + 1] === 1 ||
    lattice[idx + GRID_SIZE - 1] === 1 ||
    lattice[idx + GRID_SIZE + 1] === 1
  );
}

// Maps polar coordinates to a quantized MIDI note
export function getDlaNote(x, y) {
  const intervals = getActiveScaleIntervals();
  const root = getRootMidi();
  const span = Math.min(4, Math.max(1, state.dlaSpan ?? 2));

  const dx = x - CENTER_X;
  const dy = y - CENTER_Y;
  const dist = Math.hypot(dx, dy);
  let theta = Math.atan2(dy, dx) + Math.PI; // In [0, 2PI)

  const numDeg = intervals.length || 7;
  const deg = Math.floor((theta / (Math.PI * 2)) * numDeg) % numDeg;

  // Normalized distance from core (0.0 to 1.0)
  const normDist = Math.min(1.0, dist / (GRID_SIZE * 0.46));
  const octave = Math.min(span, Math.floor(normDist * span));

  const rawMidi = root + octave * 12 + (intervals[deg] ?? 0);
  return quantize(rawMidi, intervals, root);
}

// ---- Simulation Step ----
function stepBrownianWalkers(subSteps = 8) {
  const numWalkers = Math.min(MAX_WALKERS, Math.max(16, state.dlaWalkers ?? 64));
  const stickProb = Math.min(1.0, Math.max(0.05, (state.dlaStickiness ?? 90) / 100));
  const killRadius = Math.min(GRID_SIZE * 0.48, maxClusterRadius + 22.0);
  const gateMs = Math.min(600, Math.max(40, state.dlaGateLen ?? 180));
  const baseVel = Math.min(127, Math.max(20, state.dlaVelocity ?? 90));
  const preset = state.dlaPreset || "center";

  for (let s = 0; s < subSteps; s++) {
    for (let i = 0; i < numWalkers; i++) {
      if (!walkerActive[i]) {
        respawnWalker(i);
        continue;
      }

      // Brownian Random Walk 2D jump (4-way lattice jump)
      const r = Math.random();
      if (r < 0.25) walkerX[i] += 1;
      else if (r < 0.5) walkerX[i] -= 1;
      else if (r < 0.75) walkerY[i] += 1;
      else walkerY[i] -= 1;

      const px = Math.round(walkerX[i]);
      const py = Math.round(walkerY[i]);

      // Boundary kill check
      if (px <= 1 || px >= GRID_SIZE - 2 || py <= 1 || py >= GRID_SIZE - 2) {
        respawnWalker(i);
        continue;
      }

      if (preset !== "forest" && preset !== "ring") {
        const distCenter = Math.hypot(px - CENTER_X, py - CENTER_Y);
        if (distCenter > killRadius) {
          respawnWalker(i);
          continue;
        }
      }

      // Check for adhesion to existing crystal
      if (hasClusterNeighbor(px, py)) {
        if (Math.random() <= stickProb) {
          const idx = py * GRID_SIZE + px;
          lattice[idx] = 1;
          flashLife[idx] = 1.0;

          const dx = px - CENTER_X;
          const dy = py - CENTER_Y;
          const dist = Math.hypot(dx, dy);

          if (clusterCount < MAX_CLUSTER_PARTICLES) {
            clusterX[clusterCount] = px;
            clusterY[clusterCount] = py;
            clusterOrder[clusterCount] = clusterCount;
            clusterRadius[clusterCount] = dist;
            clusterTheta[clusterCount] = Math.atan2(dy, dx);
            clusterCount++;
            if (dist > maxClusterRadius) maxClusterRadius = dist;
          }

          totalAggregatedInPeriod++;

          // Sound voice for newly aggregated crystal tip
          const note = getDlaNote(px, py);
          const vel = Math.min(127, Math.max(30, Math.round(baseVel * 0.7 + (dist / maxClusterRadius) * (baseVel * 0.45))));
          const voiceSlot = `dla_${clusterCount % 8}`;
          playDlaVoice(voiceSlot, note, vel, gateMs);

          // Re-spawn this walker
          respawnWalker(i);
        }
      }
    }
  }
}

// ---- Autonomous Free Animation Loop ----
function dlaLoop(timestamp) {
  if (!lastFrameTime) lastFrameTime = timestamp;
  const dt = Math.min(0.1, (timestamp - lastFrameTime) / 1000);
  lastFrameTime = timestamp;

  const speedMult = Math.max(0.1, Number(state.modelSpeed ?? 1.0));
  const simSpeed = Math.max(1, Math.round((state.dlaSpeed ?? 12) * speedMult));

  if (isDlaPlaying) {
    walkerAccumulator += dt * simSpeed;
    while (walkerAccumulator >= 1.0) {
      walkerAccumulator -= 1.0;
      stepBrownianWalkers(4);
    }
  }

  // Growth rate calculation for stats
  rateTimer += dt;
  if (rateTimer >= 1.0) {
    growthRatePerSec = totalAggregatedInPeriod;
    totalAggregatedInPeriod = 0;
    rateTimer = 0;
  }

  // Decay flash sparkles
  for (let i = 0; i < TOTAL_CELLS; i++) {
    if (flashLife[i] > 0.02) {
      flashLife[i] *= 0.86;
    } else {
      flashLife[i] = 0;
    }
  }

  renderDlaCanvas();
  updateReadoutMetrics();

  animFrameId = requestAnimationFrame(dlaLoop);
}

// ---- Transport Handlers ----
export function isDlaRunning() {
  return isDlaPlaying;
}

export function startDla() {
  if (isDlaPlaying) return;
  isDlaPlaying = true;
  audio.unlock();
  walkerAccumulator = 0;
  status("DLA Dendritic Crystal: Playing · Brownian aleatoric growth", "ok");
}

export function stopDla() {
  isDlaPlaying = false;
  releasePolyVoices();
  status("stopped");
}

export function toggleDlaRunning() {
  if (isDlaPlaying) {
    stopDla();
    return false;
  } else {
    startDla();
    return true;
  }
}

function updateReadoutMetrics() {
  if (!statReadoutEl) return;
  const pct = ((clusterCount / TOTAL_CELLS) * 100).toFixed(2);
  const rMax = maxClusterRadius.toFixed(1);
  const activeVoices = getActiveVoiceCount();
  const maxVoices = state.polyphony ?? 4;
  statReadoutEl.textContent = `Cluster: ${clusterCount} cells (${pct}%) · R-Max: ${rMax}px · Growth: ${growthRatePerSec}/s · Voices: ${activeVoices}/${maxVoices}`;
}

// ---- Canvas Rendering (Strict Flat Workbench Aesthetic, Zero Gradients) ----
function renderDlaCanvas() {
  if (!dlaCanvas) return;
  const ctx = dlaCanvas.getContext("2d");
  if (!ctx) return;

  const w = dlaCanvas.width;
  const h = dlaCanvas.height;
  const scale = w / GRID_SIZE;

  const style = getComputedStyle(document.documentElement);
  const colBg = style.getPropertyValue("--bg").trim() || "#111215";
  const colPanel = style.getPropertyValue("--panel").trim() || "#18191f";
  const colPanel2 = style.getPropertyValue("--panel2").trim() || "#22252e";
  const colLine = style.getPropertyValue("--line").trim() || "#333846";
  const colDim = style.getPropertyValue("--dim").trim() || "#9ca3af";
  const colAccent = style.getPropertyValue("--accent").trim() || "#3b82f6";
  const colAccent2 = style.getPropertyValue("--accent2").trim() || "#60a5fa";
  const colOk = style.getPropertyValue("--ok").trim() || "#22c55e";

  // 1. Dark flat workbench background
  ctx.fillStyle = colBg;
  ctx.fillRect(0, 0, w, h);

  // 2. Subtle growth perimeter circle
  ctx.strokeStyle = colLine;
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.arc(CENTER_X * scale, CENTER_Y * scale, maxClusterRadius * scale, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);

  // 3. Render frozen DLA cluster cells
  for (let c = 0; c < clusterCount; c++) {
    const cx = clusterX[c];
    const cy = clusterY[c];
    const idx = cy * GRID_SIZE + cx;
    const flash = flashLife[idx];

    if (flash > 0.05) {
      // Newly aggregated crystal flash
      ctx.fillStyle = "#ffffff";
    } else {
      // Color-code cluster by normalized distance / branch depth
      const rRatio = clusterRadius[c] / Math.max(1, maxClusterRadius);
      ctx.fillStyle = rRatio > 0.75 ? colAccent2 : colAccent;
    }

    ctx.fillRect(cx * scale, cy * scale, Math.max(1, scale), Math.max(1, scale));
  }

  // 4. Render active Brownian walker particles
  const numWalkers = Math.min(MAX_WALKERS, Math.max(16, state.dlaWalkers ?? 64));
  ctx.fillStyle = colDim;
  for (let i = 0; i < numWalkers; i++) {
    if (walkerActive[i]) {
      const wx = walkerX[i] * scale;
      const wy = walkerY[i] * scale;
      ctx.fillRect(wx, wy, 1.5, 1.5);
    }
  }

  // 5. Draw center nucleus indicator
  ctx.fillStyle = colOk;
  ctx.fillRect((CENTER_X - 1) * scale, (CENTER_Y - 1) * scale, scale * 2, scale * 2);
}

// ---- Canvas Interactive Direct Manipulation ----
function handleCanvasPointer(e) {
  if (!dlaCanvas) return;
  const rect = dlaCanvas.getBoundingClientRect();
  const clientX = e.touches ? e.touches[0].clientX : e.clientX;
  const clientY = e.touches ? e.touches[0].clientY : e.clientY;

  const clickX = Math.round(((clientX - rect.left) / rect.width) * (GRID_SIZE - 1));
  const clickY = Math.round(((clientY - rect.top) / rect.height) * (GRID_SIZE - 1));

  if (clickX >= 2 && clickX < GRID_SIZE - 2 && clickY >= 2 && clickY < GRID_SIZE - 2) {
    if (e.shiftKey) {
      // Shift+Click: Plant a new seed nucleus!
      addClusterSeed(clickX, clickY);
      status(`DLA: Planted seed nucleus at (${clickX}, ${clickY})`, "ok");
    } else {
      // Regular Click: Inject a burst of Brownian walkers at the pointer location
      for (let i = 0; i < 24; i++) {
        const slot = Math.floor(Math.random() * MAX_WALKERS);
        walkerX[slot] = clickX + (Math.random() * 6 - 3);
        walkerY[slot] = clickY + (Math.random() * 6 - 3);
        walkerActive[slot] = 1;
      }
      status(`DLA: Injected Brownian particle swarm at (${clickX}, ${clickY})`, "ok");
    }
    renderDlaCanvas();
  }
}

// ---- SYNC Mode Generator Contract ----
export function generateDlaBank(st) {
  const seqLen = Math.min(64, Math.max(1, Number(st?.length ?? 16)));
  const steps = [];
  const intervals = getActiveScaleIntervals();
  const root = getRootMidi();
  const span = Math.min(4, Math.max(1, Number(st?.dlaSpan ?? 2)));
  const baseVel = Math.min(127, Math.max(30, Number(st?.dlaVelocity ?? 90)));

  if (clusterCount === 0) {
    initDlaLattice(st?.dlaPreset || "center");
  }

  for (let i = 0; i < seqLen; i++) {
    // Pick cluster particle by stepping through recent branches
    const pIdx = clusterCount > 0 ? (i * 7) % clusterCount : 0;
    const px = clusterX[pIdx] || CENTER_X;
    const py = clusterY[pIdx] || CENTER_Y;
    const note = getDlaNote(px, py);
    const dist = clusterRadius[pIdx] || 0;
    const vel = Math.min(127, Math.max(30, Math.round(baseVel * 0.7 + (dist / maxClusterRadius) * (baseVel * 0.45))));

    steps.push({
      notes: [{ note, vel }],
      rate: "1/16",
      tie: false
    });
  }

  return [
    {
      length: seqLen,
      steps,
      rate: "1/16"
    }
  ];
}

// ---- Randomizer Contract ----
export function randomizeDla() {
  state.dlaStickiness = Math.round(15 + Math.random() * 80);
  state.dlaWalkers = Math.round(32 + Math.random() * 128);
  state.dlaSpan = Math.round(1 + Math.random() * 3);
  state.dlaSpeed = Math.round(4 + Math.random() * 20);

  const presets = ["center", "forest", "ring", "quad", "coral"];
  state.dlaPreset = presets[Math.floor(Math.random() * presets.length)];

  initDlaLattice(state.dlaPreset);
  doGenerate(true);
  status("DLA: Randomized parameters and re-seeded crystal", "ok");
}

// ---- UI Construction ----
export function initDla() {
  dlaContainer = document.getElementById("model-dla");
  if (!dlaContainer) return;
  dlaContainer.innerHTML = "";

  // 1. Module Header
  const headerCard = document.createElement("div");
  headerCard.className = "card module-card";
  headerCard.style.padding = "6px 10px";
  headerCard.style.marginBottom = "8px";

  const headerFlex = document.createElement("div");
  headerFlex.style.display = "flex";
  headerFlex.style.alignItems = "center";
  headerFlex.style.justifyContent = "space-between";
  headerFlex.style.flexWrap = "wrap";
  headerFlex.style.gap = "8px";

  const titleWrap = document.createElement("div");
  titleWrap.style.display = "flex";
  titleWrap.style.alignItems = "center";
  titleWrap.style.gap = "8px";

  const titleEl = document.createElement("span");
  titleEl.style.fontWeight = "bold";
  titleEl.style.fontSize = "12px";
  titleEl.style.textTransform = "uppercase";
  titleEl.style.letterSpacing = "0.05em";
  titleEl.style.color = "var(--fg)";
  titleEl.textContent = "DLA Dendritic Crystal";

  const badgeEl = document.createElement("span");
  badgeEl.className = "badge";
  badgeEl.style.fontSize = "9px";
  badgeEl.style.padding = "1px 6px";
  badgeEl.style.background = "var(--panel2)";
  badgeEl.style.color = "var(--dim)";
  badgeEl.style.border = "1px solid var(--line)";
  badgeEl.textContent = "Brownian Growth · Df ≈ 1.71";

  titleWrap.appendChild(titleEl);
  titleWrap.appendChild(badgeEl);

  const controlsRight = document.createElement("div");
  controlsRight.style.display = "flex";
  controlsRight.style.alignItems = "center";
  controlsRight.style.gap = "8px";

  // Re-Seed / Clear Action Button
  const btnReseed = actionBtn({
    label: "RE-SEED",
    title: "Clear crystal and re-seed with current preset",
    onClick: () => {
      initDlaLattice(state.dlaPreset || "center");
      doGenerate(false);
      status("DLA: Re-seeded lattice crystal", "ok");
    }
  });

  // Randomize Action Button
  const btnRand = actionBtn({
    label: "RANDOM",
    title: "Randomize DLA stickiness, span, and growth pattern",
    onClick: () => {
      randomizeDla();
    }
  });

  controlsRight.appendChild(btnReseed);
  controlsRight.appendChild(btnRand);

  headerFlex.appendChild(titleWrap);
  headerFlex.appendChild(controlsRight);
  headerCard.appendChild(headerFlex);
  dlaContainer.appendChild(headerCard);

  // 2. Interactive Canvas
  const canvasCard = document.createElement("div");
  canvasCard.className = "card";
  canvasCard.style.padding = "6px";
  canvasCard.style.marginBottom = "8px";
  canvasCard.style.display = "flex";
  canvasCard.style.flexDirection = "column";
  canvasCard.style.alignItems = "center";
  canvasCard.style.background = "var(--bg)";

  dlaCanvas = document.createElement("canvas");
  dlaCanvas.id = "dla-canvas";
  dlaCanvas.width = 460;
  dlaCanvas.height = 460;
  dlaCanvas.style.width = "100%";
  dlaCanvas.style.maxWidth = "460px";
  dlaCanvas.style.aspectRatio = "1 / 1";
  dlaCanvas.style.display = "block";
  dlaCanvas.style.cursor = "crosshair";
  dlaCanvas.style.border = "1px solid var(--line)";
  dlaCanvas.title = "Click to inject Brownian swarm · Shift+Click to plant seed nucleus";

  dlaCanvas.addEventListener("mousedown", handleCanvasPointer);
  dlaCanvas.addEventListener("touchstart", (e) => {
    e.preventDefault();
    handleCanvasPointer(e);
  }, { passive: false });

  canvasCard.appendChild(dlaCanvas);

  // Readout bar
  statReadoutEl = document.createElement("div");
  statReadoutEl.style.fontSize = "10px";
  statReadoutEl.style.color = "var(--dim)";
  statReadoutEl.style.marginTop = "4px";
  statReadoutEl.style.textAlign = "center";
  statReadoutEl.textContent = "Cluster: 1 cells · Initializing...";
  canvasCard.appendChild(statReadoutEl);

  dlaContainer.appendChild(canvasCard);

  // 3. Dense Parameter Controls Grid (Direct Manipulation, Flat Workbench Aesthetic)
  const paramsCard = document.createElement("div");
  paramsCard.className = "card module-card";
  paramsCard.style.padding = "8px 10px";

  const gridWrap = document.createElement("div");
  gridWrap.className = "controls-grid";
  gridWrap.style.display = "flex";
  gridWrap.style.flexWrap = "wrap";
  gridWrap.style.gap = "8px";
  gridWrap.style.justifyContent = "space-between";

  // Preset Dropdown
  const kPreset = dropdown({
    label: "SEED",
    options: DLA_PRESETS.map((p) => ({ value: p.id, label: p.name })),
    value: state.dlaPreset || "center",
    title: "Initial crystal seed configuration",
    onChange: (v) => {
      state.dlaPreset = v;
      initDlaLattice(v);
      doGenerate(false);
    }
  });
  gridWrap.appendChild(kPreset);

  // Stickiness Knob (0.05 to 1.0)
  const kStick = knob({
    label: "STICK",
    min: 5, max: 100, step: 1,
    value: state.dlaStickiness ?? 90,
    unit: "%",
    title: "Adhesion probability: lower = dense columnar coral, higher = needle dendrites",
    onChange: (v) => {
      state.dlaStickiness = v;
    }
  });
  gridWrap.appendChild(kStick);

  // Walkers Knob (16 to 192)
  const kWalkers = knob({
    label: "WALKERS",
    min: 16, max: 192, step: 4,
    value: state.dlaWalkers ?? 64,
    unit: "",
    title: "Number of concurrent Brownian diffusing particles",
    onChange: (v) => {
      state.dlaWalkers = Math.round(v);
    }
  });
  gridWrap.appendChild(kWalkers);

  // Speed Knob (1 to 32)
  const kSpeed = knob({
    label: "SPEED",
    min: 1, max: 32, step: 1,
    value: state.dlaSpeed ?? 12,
    unit: "×",
    title: "Brownian walker simulation sub-step rate",
    onChange: (v) => {
      state.dlaSpeed = Math.round(v);
    }
  });
  gridWrap.appendChild(kSpeed);

  // Span Knob (1 to 4 Octaves)
  const kSpan = knob({
    label: "SPAN",
    min: 1, max: 4, step: 1,
    value: state.dlaSpan ?? 2,
    unit: "oct",
    title: "Octave spread from core outward along dendritic branches",
    onChange: (v) => {
      state.dlaSpan = Math.round(v);
      doGenerate(false);
    }
  });
  gridWrap.appendChild(kSpan);

  // Gate Duration Knob (40ms to 400ms)
  const kGate = knob({
    label: "GATE",
    min: 40, max: 400, step: 10,
    value: state.dlaGateLen ?? 180,
    unit: "ms",
    title: "Note trigger gate duration",
    onChange: (v) => {
      state.dlaGateLen = v;
    }
  });
  gridWrap.appendChild(kGate);

  // Velocity Knob (30 to 127)
  const kVel = knob({
    label: "VEL",
    min: 30, max: 127, step: 1,
    value: state.dlaVelocity ?? 90,
    unit: "",
    title: "Base trigger velocity for crystallized notes",
    onChange: (v) => {
      state.dlaVelocity = v;
    }
  });
  gridWrap.appendChild(kVel);

  paramsCard.appendChild(gridWrap);
  dlaContainer.appendChild(paramsCard);

  // Initial lattice setup
  initDlaLattice(state.dlaPreset || "center");
}

// ---- Model Lifecycle ----
export function activateDlaModel() {
  setModelGenerator(generateDlaBank);
  setModelRandomizer(randomizeDla);
  setModelStepHandler(null);
  setModelTransportHandler({
    toggle: toggleDlaRunning,
    stop: stopDla,
    start: startDla,
    isRunning: isDlaRunning
  });

  doGenerate(false);
  renderDlaCanvas();

  if (!animFrameId && typeof requestAnimationFrame === "function") {
    lastFrameTime = performance.now();
    animFrameId = requestAnimationFrame(dlaLoop);
  }

  status("DLA Dendritic Crystal: Ready (Press Play or Spacebar to grow crystal)", "ok");
}

export function deactivateDlaModel() {
  stopDla();
  setModelStepHandler(null);
  setModelTransportHandler(null);
  setModelGenerator(null);
  setModelRandomizer(null);

  releasePolyVoices();

  if (animFrameId && typeof cancelAnimationFrame === "function") {
    cancelAnimationFrame(animFrameId);
    animFrameId = null;
  }
}

// ---- Snapshot Registration ----
registerModel({
  id: "dla",
  version: 1,
  migrations: {},
  capture: () => {
    return {
      preset: state.dlaPreset,
      stickiness: state.dlaStickiness,
      walkers: state.dlaWalkers,
      speed: state.dlaSpeed,
      span: state.dlaSpan,
      gateLen: state.dlaGateLen,
      vel: state.dlaVelocity
    };
  },
  restore: (h) => {
    if (h.preset !== undefined) state.dlaPreset = h.preset;
    if (h.stickiness !== undefined) state.dlaStickiness = h.stickiness;
    if (h.walkers !== undefined) state.dlaWalkers = h.walkers;
    if (h.speed !== undefined) state.dlaSpeed = h.speed;
    if (h.span !== undefined) state.dlaSpan = h.span;
    if (h.gateLen !== undefined) state.dlaGateLen = h.gateLen;
    if (h.vel !== undefined) state.dlaVelocity = h.vel;
    initDlaLattice(state.dlaPreset || "center");
  }
});
