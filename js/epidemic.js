// epidemic.js — SIR Epidemic Network Dynamics (Contagion) Sequencer for FM-1 Pulses.
// Population dynamics, stochastic contact proximity graphs, and epidemiological macro-arcs.
//
// Generative Architecture:
// 1. Stochastic SIR (Susceptible -> Infected -> Recovered) spatial transmission model.
// 2. Continuous reproduction ratio R0 = beta / gamma driving macro-structural musical climaxes.
// 3. Polar anomaly angle and radial centroid distance quantizing to scale degrees and octaves.
// 4. Strict 8-voice polyphony ceiling with shared voice allocation via js/poly.js.
// 5. Continuous Timbre CC #74 Brightness modulation via dispatchTimbreCc() driven by active infection prevalence (I / N).
// 6. Direct manipulation: interactive canvas to infect nodes (patient zero), immunize clusters, or inject variants.
// 7. Dual Sync/Free modes: 64-step transport-locked rhythm pattern or continuous autonomous contagion waves.

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
const MAX_NODES = 128;

// Node Spatial Coordinates [0.0, 1.0]
const posX = new Float32Array(MAX_NODES);
const posY = new Float32Array(MAX_NODES);
const velX = new Float32Array(MAX_NODES);
const velY = new Float32Array(MAX_NODES);

// State: 0 = Susceptible (S), 1 = Infected (I), 2 = Recovered/Immune (R)
const nodeState = new Uint8Array(MAX_NODES);
const nodeTimer = new Float32Array(MAX_NODES);
const nodeFlash = new Float32Array(MAX_NODES);
const nodePitch = new Int16Array(MAX_NODES);

// Transmission link animation tracking
const MAX_LINKS = 64;
const linkSource = new Int16Array(MAX_LINKS);
const linkTarget = new Int16Array(MAX_LINKS);
const linkAlpha = new Float32Array(MAX_LINKS);
let linkHead = 0;

// Simulation State
let isEpidemicPlaying = false;
let animFrameId = null;
let lastFrameTime = 0;
let stepAccumulator = 0;
let waveCounter = 1;
let extinctCooldown = 0;

// Population Metrics
let countS = 0;
let countI = 0;
let countR = 0;
let totalCases = 0;

// DOM & Canvas elements
let epidemicContainer = null;
let epidemicCanvas = null;
let statReadoutEl = null;

// Presets
export const EPIDEMIC_PRESETS = [
  { id: "spiral", name: "Sunflower Spiral", desc: "Vogel phyllotaxis spiral; structured radial contagion wavefronts" },
  { id: "clusters", name: "Town Metapopulations", desc: "3 dense community clusters connected by sparse transit bridges" },
  { id: "mobile", name: "Mobile Drift Swarm", desc: "Wandering Brownian agents colliding dynamically in space" },
  { id: "lattice", name: "2D Grid Lattice", desc: "Structured regular contact grid; circular wave expansion" },
  { id: "ring", name: "Concentric Rings", desc: "Nested radial orbits creating layered polyphonic choral rings" }
];

// ---- Audio Dispatch & 8-Voice Polyphony Ceiling (via js/poly.js) ----
function playEpidemicVoice(nodeId, note, vel, durMs) {
  playVoice(nodeId, note, vel, durMs);
}

function releaseAllVoices() {
  releasePolyVoices();
}

// Maps node spatial position to a scale-quantized pitch
export function getEpidemicNodeNote(x, y) {
  const intervals = getActiveScaleIntervals();
  const root = getRootMidi();
  const span = Math.min(4, Math.max(1, Number(state.epidemicSpan ?? 2)));

  const dx = x - 0.5;
  const dy = y - 0.5;
  const dist = Math.hypot(dx, dy);
  let theta = Math.atan2(dy, dx) + Math.PI; // in [0, 2PI)

  const numDeg = intervals.length || 7;
  const deg = Math.floor((theta / (Math.PI * 2)) * numDeg) % numDeg;

  // Normalized radial octave mapping
  const normDist = Math.min(1.0, dist / 0.48);
  const oct = Math.min(span, Math.floor(normDist * span));

  const rawMidi = root + oct * 12 + (intervals[deg] ?? 0);
  return quantize(rawMidi, intervals, root);
}

// ---- Network Topology Initialization ----
export function initEpidemicGraph(presetId = state.epidemicPreset || "spiral") {
  const N = Math.min(MAX_NODES, Math.max(16, Number(state.epidemicNodes ?? 48)));

  nodeState.fill(0);
  nodeTimer.fill(0);
  nodeFlash.fill(0);
  linkAlpha.fill(0);
  linkHead = 0;
  totalCases = 0;
  extinctCooldown = 0;

  if (presetId === "spiral") {
    // Vogel Sunflower Phyllotaxis Spiral
    const goldenAngle = 2.3999632;
    for (let i = 0; i < N; i++) {
      const r = Math.sqrt((i + 0.5) / N) * 0.42;
      const theta = i * goldenAngle;
      posX[i] = 0.5 + Math.cos(theta) * r;
      posY[i] = 0.5 + Math.sin(theta) * r;
      velX[i] = 0;
      velY[i] = 0;
      nodePitch[i] = getEpidemicNodeNote(posX[i], posY[i]);
    }
  } else if (presetId === "clusters") {
    // 3 Dense Metropolitan Hubs with Inter-Hub Bridges
    const hubs = [
      { cx: 0.28, cy: 0.32 },
      { cx: 0.72, cy: 0.35 },
      { cx: 0.50, cy: 0.75 }
    ];
    for (let i = 0; i < N; i++) {
      const hub = hubs[i % 3];
      const r = Math.sqrt(Math.random()) * 0.16;
      const angle = Math.random() * Math.PI * 2;
      posX[i] = Math.min(0.92, Math.max(0.08, hub.cx + Math.cos(angle) * r));
      posY[i] = Math.min(0.92, Math.max(0.08, hub.cy + Math.sin(angle) * r));
      velX[i] = 0;
      velY[i] = 0;
      nodePitch[i] = getEpidemicNodeNote(posX[i], posY[i]);
    }
  } else if (presetId === "mobile") {
    // Wandering Agents with Drift Velocity
    for (let i = 0; i < N; i++) {
      posX[i] = 0.1 + Math.random() * 0.8;
      posY[i] = 0.1 + Math.random() * 0.8;
      const speed = 0.04 + Math.random() * 0.06;
      const heading = Math.random() * Math.PI * 2;
      velX[i] = Math.cos(heading) * speed;
      velY[i] = Math.sin(heading) * speed;
      nodePitch[i] = getEpidemicNodeNote(posX[i], posY[i]);
    }
  } else if (presetId === "lattice") {
    // 2D Square Grid
    const cols = Math.ceil(Math.sqrt(N));
    const rows = Math.ceil(N / cols);
    for (let i = 0; i < N; i++) {
      const c = i % cols;
      const r = Math.floor(i / cols);
      posX[i] = 0.15 + (c / Math.max(1, cols - 1)) * 0.7;
      posY[i] = 0.15 + (r / Math.max(1, rows - 1)) * 0.7;
      velX[i] = 0;
      velY[i] = 0;
      nodePitch[i] = getEpidemicNodeNote(posX[i], posY[i]);
    }
  } else if (presetId === "ring") {
    // Concentric Circular Rings
    const rings = 3;
    for (let i = 0; i < N; i++) {
      const ringIdx = i % rings;
      const r = 0.12 + (ringIdx / (rings - 1)) * 0.32;
      const angle = (Math.floor(i / rings) / Math.ceil(N / rings)) * Math.PI * 2;
      posX[i] = 0.5 + Math.cos(angle) * r;
      posY[i] = 0.5 + Math.sin(angle) * r;
      velX[i] = 0;
      velY[i] = 0;
      nodePitch[i] = getEpidemicNodeNote(posX[i], posY[i]);
    }
  }

  // Inoculate Patient Zero (Initial Outbreak) - silent during graph setup
  infectNode(0, -1, false);

  updatePopulationCounts();
  renderEpidemicCanvas();
  updateReadoutMetrics();
}

// Inoculates / infects a specific node
export function infectNode(nodeId, sourceId = -1, playSound = true) {
  const N = Math.min(MAX_NODES, Math.max(16, Number(state.epidemicNodes ?? 48)));
  if (nodeId < 0 || nodeId >= N) return;

  nodeState[nodeId] = 1; // Infected
  const recTime = Math.max(2, Number(state.epidemicRecovery ?? 12));
  nodeTimer[nodeId] = recTime;
  nodeFlash[nodeId] = 1.0;
  totalCases++;

  // Record transmission visual link
  if (sourceId >= 0 && sourceId < N) {
    const l = (linkHead++) % MAX_LINKS;
    linkSource[l] = sourceId;
    linkTarget[l] = nodeId;
    linkAlpha[l] = 1.0;
  }

  // Derive note and dispatch voice
  const note = getEpidemicNodeNote(posX[nodeId], posY[nodeId]);
  nodePitch[nodeId] = note;

  if (playSound && isRunning) {
    const baseVel = Math.min(127, Math.max(30, Number(state.epidemicVelocity ?? 90)));
    const dist = Math.hypot(posX[nodeId] - 0.5, posY[nodeId] - 0.5);
    const vel = Math.min(127, Math.max(35, Math.round(baseVel * 0.75 + (dist / 0.5) * (baseVel * 0.35))));
    const gateMs = Math.min(600, Math.max(40, Number(state.epidemicGateLen ?? 200)));

    playEpidemicVoice(`epi_${nodeId % 8}`, note, vel, gateMs);

    // Modulate FM-1 CC #74 Brightness with epidemic prevalence (I / N)
    const prevalence = Math.min(1.0, countI / N);
    dispatchTimbreCc(prevalence, {
      dest: state.epidemicCcDest ?? 74,
      depth: state.epidemicCcDepth ?? 85,
      minVal: 20
    });
  }
}

function updatePopulationCounts() {
  const N = Math.min(MAX_NODES, Math.max(16, Number(state.epidemicNodes ?? 48)));
  countS = 0;
  countI = 0;
  countR = 0;
  for (let i = 0; i < N; i++) {
    if (nodeState[i] === 0) countS++;
    else if (nodeState[i] === 1) countI++;
    else if (nodeState[i] === 2) countR++;
  }
}

// ---- Simulation Step ----
function stepEpidemicTransmission(dt = 0.05) {
  const N = Math.min(MAX_NODES, Math.max(16, Number(state.epidemicNodes ?? 48)));
  const beta = Math.min(1.0, Math.max(0.05, Number(state.epidemicBeta ?? 45) / 100));
  const contactRadius = Math.min(0.6, Math.max(0.06, Number(state.epidemicRadius ?? 0.22)));
  const immunityDuration = Math.max(4, Number(state.epidemicImmunity ?? 24));
  const isMobile = state.epidemicPreset === "mobile";

  // 1. Update position of mobile wandering agents
  if (isMobile) {
    for (let i = 0; i < N; i++) {
      posX[i] += velX[i] * dt;
      posY[i] += velY[i] * dt;

      // Bounce off boundaries [0.08, 0.92]
      if (posX[i] < 0.08) { posX[i] = 0.08; velX[i] = Math.abs(velX[i]); }
      else if (posX[i] > 0.92) { posX[i] = 0.92; velX[i] = -Math.abs(velX[i]); }
      if (posY[i] < 0.08) { posY[i] = 0.08; velY[i] = Math.abs(velY[i]); }
      else if (posY[i] > 0.92) { posY[i] = 0.92; velY[i] = -Math.abs(velY[i]); }
    }
  }

  // 2. Spatial Contagion Transmission: Infected nodes spread virus to Susceptible neighbors
  for (let i = 0; i < N; i++) {
    if (nodeState[i] === 1) { // Infectious
      for (let j = 0; j < N; j++) {
        if (i !== j && nodeState[j] === 0) { // Susceptible contact
          const dx = posX[i] - posX[j];
          const dy = posY[i] - posY[j];
          const dist = Math.hypot(dx, dy);

          if (dist <= contactRadius) {
            // Distance-decay transmission probability
            const distanceDecay = 1.0 - (dist / contactRadius) * 0.45;
            if (Math.random() < beta * distanceDecay * 0.4) {
              infectNode(j, i);
            }
          }
        }
      }
    }
  }

  // 3. State Timers: I -> R (Recovery) and R -> S (Waning Immunity)
  for (let i = 0; i < N; i++) {
    if (nodeState[i] === 1) {
      // Infected node ticks down toward recovery
      nodeTimer[i] -= dt * 6.0;
      if (nodeTimer[i] <= 0) {
        nodeState[i] = 2; // Recovered/Immune
        nodeTimer[i] = immunityDuration;
        nodeFlash[i] = 0.6; // Soft recovery flash
      }
    } else if (nodeState[i] === 2) {
      // Recovered node waning immunity ticks down
      nodeTimer[i] -= dt * 3.0;
      if (nodeTimer[i] <= 0) {
        nodeState[i] = 0; // Susceptible once again
      }
    }
  }

  updatePopulationCounts();

  // 4. Auto-Reseed / Resurgence: If infection goes extinct (I == 0), trigger a new wave after refractory lull
  if (countI === 0) {
    extinctCooldown += dt;
    if (extinctCooldown >= 1.8) {
      extinctCooldown = 0;
      waveCounter++;
      // Select random susceptible node or re-inoculate random node
      const targetId = Math.floor(Math.random() * N);
      infectNode(targetId);
      status(`Epidemic: Wave #${waveCounter} resurgence inoculated`, "ok");
    }
  } else {
    extinctCooldown = 0;
  }
}

// ---- Autonomous Free Animation Loop ----
function epidemicLoop(timestamp) {
  if (!lastFrameTime) lastFrameTime = timestamp;
  const dt = Math.min(0.1, (timestamp - lastFrameTime) / 1000);
  lastFrameTime = timestamp;

  const speedMult = Math.max(0.1, Number(state.modelSpeed ?? 1.0));
  const simSpeed = Math.max(0.5, (state.epidemicSpeed ?? 1.0) * speedMult);

  if (isEpidemicPlaying) {
    stepAccumulator += dt * simSpeed;
    while (stepAccumulator >= 0.05) {
      stepAccumulator -= 0.05;
      stepEpidemicTransmission(0.05);
    }
  }

  // Decay flash highlights
  const N = Math.min(MAX_NODES, Math.max(16, Number(state.epidemicNodes ?? 48)));
  for (let i = 0; i < N; i++) {
    if (nodeFlash[i] > 0.02) nodeFlash[i] *= 0.88;
    else nodeFlash[i] = 0;
  }

  // Decay transmission link animations
  for (let l = 0; l < MAX_LINKS; l++) {
    if (linkAlpha[l] > 0.02) linkAlpha[l] *= 0.82;
    else linkAlpha[l] = 0;
  }

  renderEpidemicCanvas();
  updateReadoutMetrics();

  animFrameId = requestAnimationFrame(epidemicLoop);
}

// ---- Transport Handlers ----
export function isEpidemicRunning() {
  return isEpidemicPlaying;
}

export function startEpidemic() {
  if (isEpidemicPlaying) return;
  isEpidemicPlaying = true;
  audio.unlock();
  stepAccumulator = 0;
  updatePlayBtnUI();
  status("Epidemic Network: Playing · SIR Contagion Waves", "ok");
}

export function stopEpidemic() {
  isEpidemicPlaying = false;
  releaseAllVoices();
  updatePlayBtnUI();
  status("stopped");
}

export function toggleEpidemicRunning() {
  if (isEpidemicPlaying) {
    stopEpidemic();
    return false;
  } else {
    startEpidemic();
    return true;
  }
}

function updatePlayBtnUI() {
  const headerBtn = document.getElementById("audition");
  if (headerBtn) {
    headerBtn.textContent = isEpidemicPlaying ? "■ Stop" : "▶ Play";
    if (isEpidemicPlaying) {
      headerBtn.classList.add("playing");
    } else {
      headerBtn.classList.remove("playing");
    }
  }
}

function updateReadoutMetrics() {
  if (!statReadoutEl) return;
  const N = Math.min(MAX_NODES, Math.max(16, Number(state.epidemicNodes ?? 48)));
  const beta = Number(state.epidemicBeta ?? 45);
  const recTime = Number(state.epidemicRecovery ?? 12);
  const r0 = ((beta / 100) * (recTime / 3)).toFixed(2);
  const activeVoices = getActiveVoiceCount();
  const maxVoices = state.polyphony ?? 4;

  statReadoutEl.textContent = `N: ${N} · S: ${countS} · I: ${countI} (Active) · R: ${countR} · R₀: ${r0} · Wave: #${waveCounter} · Voices: ${activeVoices}/${maxVoices}`;
}

// ---- Canvas Rendering (Strict Flat Workbench Aesthetic, Zero Gradients) ----
function renderEpidemicCanvas() {
  if (!epidemicCanvas) return;
  const ctx = epidemicCanvas.getContext("2d");
  if (!ctx) return;

  const w = epidemicCanvas.width;
  const h = epidemicCanvas.height;
  const N = Math.min(MAX_NODES, Math.max(16, Number(state.epidemicNodes ?? 48)));
  const contactRadius = Math.min(0.6, Math.max(0.06, Number(state.epidemicRadius ?? 0.22)));

  const style = getComputedStyle(document.documentElement);
  const colBg = style.getPropertyValue("--bg").trim() || "#111215";
  const colPanel2 = style.getPropertyValue("--panel2").trim() || "#22252e";
  const colLine = style.getPropertyValue("--line").trim() || "#333846";
  const colDim = style.getPropertyValue("--dim").trim() || "#9ca3af";
  const colAccent = style.getPropertyValue("--accent").trim() || "#3b82f6";
  const colAccent2 = style.getPropertyValue("--accent2").trim() || "#60a5fa";
  const colOk = style.getPropertyValue("--ok").trim() || "#22c55e";
  const colErr = style.getPropertyValue("--err").trim() || "#ef4444";

  // 1. Dark flat workbench background
  ctx.fillStyle = colBg;
  ctx.fillRect(0, 0, w, h);

  // 2. Render static/ambient proximity proximity edges between nearby nodes
  ctx.strokeStyle = colLine;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 0; i < N; i++) {
    for (let j = i + 1; j < N; j++) {
      const dx = (posX[i] - posX[j]) * w;
      const dy = (posY[i] - posY[j]) * h;
      const d = Math.hypot(dx, dy);
      if (d <= contactRadius * w) {
        ctx.moveTo(posX[i] * w, posY[i] * h);
        ctx.lineTo(posX[j] * w, posY[j] * h);
      }
    }
  }
  ctx.stroke();

  // 3. Render active transmission flashes (vector links)
  ctx.lineWidth = 2;
  for (let l = 0; l < MAX_LINKS; l++) {
    const a = linkAlpha[l];
    if (a > 0.05) {
      const s = linkSource[l];
      const t = linkTarget[l];
      if (s >= 0 && s < N && t >= 0 && t < N) {
        ctx.strokeStyle = colErr;
        ctx.beginPath();
        ctx.moveTo(posX[s] * w, posY[s] * h);
        ctx.lineTo(posX[t] * w, posY[t] * h);
        ctx.stroke();
      }
    }
  }

  // 4. Render spatial population nodes
  for (let i = 0; i < N; i++) {
    const px = posX[i] * w;
    const py = posY[i] * h;
    const flash = nodeFlash[i];
    const st = nodeState[i];

    // Contact threshold halo for currently infectious nodes
    if (st === 1) {
      ctx.strokeStyle = colErr;
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 4]);
      ctx.beginPath();
      ctx.arc(px, py, contactRadius * w * 0.5, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    ctx.beginPath();
    let nodeRadius = 5.5;

    if (flash > 0.05) {
      // Note trigger burst
      nodeRadius = 8.5;
      ctx.fillStyle = "#ffffff";
    } else if (st === 0) {
      // Susceptible (S): Cool blue/dim open ring
      ctx.fillStyle = colPanel2;
      ctx.strokeStyle = colDim;
      ctx.lineWidth = 1.5;
      ctx.arc(px, py, nodeRadius, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      continue;
    } else if (st === 1) {
      // Infected (I): High-visibility contagion red/amber
      ctx.fillStyle = colErr;
    } else {
      // Recovered/Immune (R): Protective ok green
      ctx.fillStyle = colOk;
    }

    ctx.arc(px, py, nodeRadius, 0, Math.PI * 2);
    ctx.fill();

    // Active pitch label inside/near node
    if (st === 1 && nodePitch[i]) {
      ctx.fillStyle = "#ffffff";
      ctx.font = "9px monospace";
      ctx.textAlign = "center";
      ctx.fillText(midiName(nodePitch[i]), px, py - 9);
    }
  }
}

// ---- Canvas Interactive Direct Manipulation ----
function handleCanvasPointer(e) {
  if (!epidemicCanvas) return;
  const rect = epidemicCanvas.getBoundingClientRect();
  const clientX = e.touches ? e.touches[0].clientX : e.clientX;
  const clientY = e.touches ? e.touches[0].clientY : e.clientY;

  const clickX = (clientX - rect.left) / rect.width;
  const clickY = (clientY - rect.top) / rect.height;
  const N = Math.min(MAX_NODES, Math.max(16, Number(state.epidemicNodes ?? 48)));

  // Find nearest node
  let nearestIdx = -1;
  let minDist = Infinity;
  for (let i = 0; i < N; i++) {
    const d = Math.hypot(posX[i] - clickX, posY[i] - clickY);
    if (d < minDist) {
      minDist = d;
      nearestIdx = i;
    }
  }

  if (nearestIdx >= 0 && minDist < 0.15) {
    if (e.shiftKey) {
      // Shift+Click: Immunize node (Quarantine S -> R)
      nodeState[nearestIdx] = 2; // Recovered/Immune
      nodeTimer[nearestIdx] = Number(state.epidemicImmunity ?? 24) * 2;
      nodeFlash[nearestIdx] = 0.8;
      status(`Epidemic: Inoculated node #${nearestIdx} with immunity`, "ok");
    } else {
      // Click: Infect node (Patient Zero trigger)
      infectNode(nearestIdx);
      status(`Epidemic: Inoculated infection at node #${nearestIdx}`, "ok");
    }
    updatePopulationCounts();
    renderEpidemicCanvas();
    updateReadoutMetrics();
  }
}

// ---- SYNC Mode Generator Contract ----
export function generateEpidemicBank(st) {
  const seqLen = Math.min(64, Math.max(1, Number(st?.length ?? 16)));
  const steps = [];
  const N = Math.min(MAX_NODES, Math.max(16, Number(st?.epidemicNodes ?? 48)));
  const baseVel = Math.min(127, Math.max(30, Number(st?.epidemicVelocity ?? 90)));

  if (countI === 0) {
    infectNode(0);
  }

  for (let i = 0; i < seqLen; i++) {
    // Pick an active infected node or cycle through population
    const targetIdx = (i * 3) % N;
    const note = getEpidemicNodeNote(posX[targetIdx], posY[targetIdx]);
    const dist = Math.hypot(posX[targetIdx] - 0.5, posY[targetIdx] - 0.5);
    const vel = Math.min(127, Math.max(30, Math.round(baseVel * 0.75 + (dist / 0.5) * (baseVel * 0.35))));

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
export function randomizeEpidemic() {
  state.epidemicBeta = Math.round(20 + Math.random() * 65);
  state.epidemicRadius = Number((0.12 + Math.random() * 0.28).toFixed(2));
  state.epidemicRecovery = Math.round(6 + Math.random() * 20);
  state.epidemicImmunity = Math.round(12 + Math.random() * 36);
  state.epidemicSpan = Math.round(1 + Math.random() * 3);

  const presets = ["spiral", "clusters", "mobile", "lattice", "ring"];
  state.epidemicPreset = presets[Math.floor(Math.random() * presets.length)];

  initEpidemicGraph(state.epidemicPreset);
  doGenerate(true);
  status("Epidemic: Randomized parameters and re-seeded outbreak", "ok");
}

// ---- UI Construction ----
export function initEpidemic() {
  epidemicContainer = document.getElementById("model-epidemic");
  if (!epidemicContainer) return;
  epidemicContainer.innerHTML = "";

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
  titleEl.textContent = "SIR Epidemic Network Dynamics";

  const badgeEl = document.createElement("span");
  badgeEl.className = "badge";
  badgeEl.style.fontSize = "9px";
  badgeEl.style.padding = "1px 6px";
  badgeEl.style.background = "var(--panel2)";
  badgeEl.style.color = "var(--dim)";
  badgeEl.style.border = "1px solid var(--line)";
  badgeEl.textContent = "Stochastic Contagion · R0 Threshold";

  titleWrap.appendChild(titleEl);
  titleWrap.appendChild(badgeEl);

  const controlsRight = document.createElement("div");
  controlsRight.style.display = "flex";
  controlsRight.style.alignItems = "center";
  controlsRight.style.gap = "8px";

  // Re-Seed Outbreak Action Button
  const btnReseed = actionBtn({
    label: "PATIENT ZERO",
    title: "Inoculate a fresh outbreak at random node",
    onClick: () => {
      const N = Math.min(MAX_NODES, Math.max(16, Number(state.epidemicNodes ?? 48)));
      infectNode(Math.floor(Math.random() * N));
      doGenerate(false);
      status("Epidemic: Inoculated new outbreak wave", "ok");
    }
  });

  // Vaccinate Population Action Button
  const btnVaccinate = actionBtn({
    label: "VACCINATE",
    title: "Immunize 50% of the population",
    onClick: () => {
      const N = Math.min(MAX_NODES, Math.max(16, Number(state.epidemicNodes ?? 48)));
      for (let i = 0; i < N; i++) {
        if (Math.random() < 0.5) {
          nodeState[i] = 2; // Recovered/Immune
          nodeTimer[i] = Number(state.epidemicImmunity ?? 24) * 2;
          nodeFlash[i] = 0.6;
        }
      }
      updatePopulationCounts();
      renderEpidemicCanvas();
      updateReadoutMetrics();
      status("Epidemic: Vaccinated 50% of population", "ok");
    }
  });

  // Randomize Action Button
  const btnRand = actionBtn({
    label: "RANDOM",
    title: "Randomize transmission rate, contact radius, and network graph",
    onClick: () => {
      randomizeEpidemic();
    }
  });

  controlsRight.appendChild(btnReseed);
  controlsRight.appendChild(btnVaccinate);
  controlsRight.appendChild(btnRand);

  headerFlex.appendChild(titleWrap);
  headerFlex.appendChild(controlsRight);
  headerCard.appendChild(headerFlex);
  epidemicContainer.appendChild(headerCard);

  // 2. Interactive Network Graph Canvas
  const canvasCard = document.createElement("div");
  canvasCard.className = "card";
  canvasCard.style.padding = "6px";
  canvasCard.style.marginBottom = "8px";
  canvasCard.style.display = "flex";
  canvasCard.style.flexDirection = "column";
  canvasCard.style.alignItems = "center";
  canvasCard.style.background = "var(--bg)";

  epidemicCanvas = document.createElement("canvas");
  epidemicCanvas.id = "epidemic-canvas";
  epidemicCanvas.width = 460;
  epidemicCanvas.height = 460;
  epidemicCanvas.style.width = "100%";
  epidemicCanvas.style.maxWidth = "460px";
  epidemicCanvas.style.aspectRatio = "1 / 1";
  epidemicCanvas.style.display = "block";
  epidemicCanvas.style.cursor = "crosshair";
  epidemicCanvas.style.border = "1px solid var(--line)";
  epidemicCanvas.title = "Click to infect node · Shift+Click to immunize";

  epidemicCanvas.addEventListener("mousedown", handleCanvasPointer);
  epidemicCanvas.addEventListener("touchstart", (e) => {
    e.preventDefault();
    handleCanvasPointer(e);
  }, { passive: false });

  canvasCard.appendChild(epidemicCanvas);

  // Readout status bar
  statReadoutEl = document.createElement("div");
  statReadoutEl.style.fontSize = "10px";
  statReadoutEl.style.color = "var(--dim)";
  statReadoutEl.style.marginTop = "4px";
  statReadoutEl.style.textAlign = "center";
  statReadoutEl.textContent = "Population: 48 · Initializing...";
  canvasCard.appendChild(statReadoutEl);

  epidemicContainer.appendChild(canvasCard);

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

  // Topology Preset Dropdown
  const kPreset = dropdown({
    label: "TOPOLOGY",
    options: EPIDEMIC_PRESETS.map((p) => ({ value: p.id, label: p.name })),
    value: state.epidemicPreset || "spiral",
    title: "Spatial population contact network topology",
    onChange: (v) => {
      state.epidemicPreset = v;
      initEpidemicGraph(v);
      doGenerate(false);
    }
  });
  gridWrap.appendChild(kPreset);

  // Nodes Knob (16 to 96)
  const kNodes = knob({
    label: "NODES",
    min: 16, max: 96, step: 4,
    value: state.epidemicNodes ?? 48,
    unit: "",
    title: "Number of agents in population",
    onChange: (v) => {
      state.epidemicNodes = Math.round(v);
      initEpidemicGraph(state.epidemicPreset || "spiral");
      doGenerate(false);
    }
  });
  gridWrap.appendChild(kNodes);

  // Transmission Rate Beta Knob (5% to 95%)
  const kBeta = knob({
    label: "BETA (β)",
    min: 5, max: 95, step: 1,
    value: state.epidemicBeta ?? 45,
    unit: "%",
    title: "Viral transmission probability across contact edges",
    onChange: (v) => {
      state.epidemicBeta = v;
    }
  });
  gridWrap.appendChild(kBeta);

  // Contact Proximity Radius Knob (0.08 to 0.45)
  const kRadius = knob({
    label: "RADIUS",
    min: 8, max: 45, step: 1,
    value: Math.round((state.epidemicRadius ?? 0.22) * 100),
    unit: "%",
    title: "Spatial contact transmission distance threshold",
    onChange: (v) => {
      state.epidemicRadius = v / 100;
    }
  });
  gridWrap.appendChild(kRadius);

  // Recovery Time Knob (4 to 32 ticks)
  const kRec = knob({
    label: "RECOVERY",
    min: 4, max: 32, step: 1,
    value: state.epidemicRecovery ?? 12,
    unit: "tk",
    title: "Infection duration before transitioning to recovered (I -> R)",
    onChange: (v) => {
      state.epidemicRecovery = Math.round(v);
    }
  });
  gridWrap.appendChild(kRec);

  // Immunity Duration Knob (6 to 64 ticks)
  const kImm = knob({
    label: "IMMUNITY",
    min: 6, max: 64, step: 2,
    value: state.epidemicImmunity ?? 24,
    unit: "tk",
    title: "Duration of temporary protective immunity before waning (R -> S)",
    onChange: (v) => {
      state.epidemicImmunity = Math.round(v);
    }
  });
  gridWrap.appendChild(kImm);

  // Span Knob (1 to 4 Octaves)
  const kSpan = knob({
    label: "SPAN",
    min: 1, max: 4, step: 1,
    value: state.epidemicSpan ?? 2,
    unit: "oct",
    title: "Octave spread mapped from core outward along network radius",
    onChange: (v) => {
      state.epidemicSpan = Math.round(v);
      doGenerate(false);
    }
  });
  gridWrap.appendChild(kSpan);

  // Gate Duration Knob (40ms to 400ms)
  const kGate = knob({
    label: "GATE",
    min: 40, max: 400, step: 10,
    value: state.epidemicGateLen ?? 200,
    unit: "ms",
    title: "Note trigger gate duration",
    onChange: (v) => {
      state.epidemicGateLen = v;
    }
  });
  gridWrap.appendChild(kGate);

  // CC #74 Brightness Depth Knob (0 to 127)
  const kCc = knob({
    label: "CC #74",
    min: 0, max: 127, step: 1,
    value: state.epidemicCcDepth ?? 85,
    unit: "",
    title: "Depth of continuous FM-1 CC #74 modulation driven by active infection prevalence",
    onChange: (v) => {
      state.epidemicCcDepth = v;
    }
  });
  gridWrap.appendChild(kCc);

  paramsCard.appendChild(gridWrap);
  epidemicContainer.appendChild(paramsCard);

  // Initial network graph setup
  initEpidemicGraph(state.epidemicPreset || "spiral");
}

// ---- Model Lifecycle ----
export function activateEpidemicModel() {
  setModelGenerator(generateEpidemicBank);
  setModelRandomizer(randomizeEpidemic);
  setModelStepHandler(null);
  setModelTransportHandler({
    toggle: toggleEpidemicRunning,
    stop: stopEpidemic,
    start: startEpidemic,
    isRunning: isEpidemicRunning
  });

  doGenerate(false);
  renderEpidemicCanvas();

  if (!animFrameId) {
    lastFrameTime = performance.now();
    animFrameId = requestAnimationFrame(epidemicLoop);
  }

  updatePlayBtnUI();
  status("Epidemic Network Dynamics: Ready (Press Play or Spacebar to run contagion)", "ok");
}

export function deactivateEpidemicModel() {
  stopEpidemic();
  setModelStepHandler(null);
  setModelTransportHandler(null);
  setModelGenerator(null);
  setModelRandomizer(null);

  releasePolyVoices();

  if (animFrameId) {
    cancelAnimationFrame(animFrameId);
    animFrameId = null;
  }
}

// ---- Snapshot Registration ----
registerModel({
  id: "epidemic",
  version: 1,
  migrations: {},
  capture: () => {
    return {
      preset: state.epidemicPreset,
      nodes: state.epidemicNodes,
      beta: state.epidemicBeta,
      radius: state.epidemicRadius,
      recovery: state.epidemicRecovery,
      immunity: state.epidemicImmunity,
      span: state.epidemicSpan,
      gateLen: state.epidemicGateLen,
      ccDepth: state.epidemicCcDepth
    };
  },
  restore: (h) => {
    if (h.preset !== undefined) state.epidemicPreset = h.preset;
    if (h.nodes !== undefined) state.epidemicNodes = h.nodes;
    if (h.beta !== undefined) state.epidemicBeta = h.beta;
    if (h.radius !== undefined) state.epidemicRadius = h.radius;
    if (h.recovery !== undefined) state.epidemicRecovery = h.recovery;
    if (h.immunity !== undefined) state.epidemicImmunity = h.immunity;
    if (h.span !== undefined) state.epidemicSpan = h.span;
    if (h.gateLen !== undefined) state.epidemicGateLen = h.gateLen;
    if (h.ccDepth !== undefined) state.epidemicCcDepth = h.ccDepth;
    initEpidemicGraph(state.epidemicPreset || "spiral");
  }
});
