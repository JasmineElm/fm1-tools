// physarum.js — Physarum Polycephalum Slime Mould Network Sequencer for FM-1 Pulses.
// Bio-computational multi-agent foraging, 2D chemotaxis field diffusion, and Steiner transport networks.
//
// Generative Architecture:
// 1. Multi-Agent Chemotaxis Simulation (Jeff Jones 2010 formulation):
//    - Autonomous mobile agents sample 2D chemoattractant trail field using 3 directional sensors (FL, F, FR).
//    - Agents steer toward highest pheromone gradient, deposit chemoattractant, and self-organize into veins.
// 2. 2D Pheromone Field Diffusion & Evaporation:
//    - Real-time Laplacian diffusion and exponential decay create fluid protoplasmic tubes.
// 3. Food / Nutrient Nodes (Oats) as Polyphonic Voice Sources:
//    - 1 to 8 food nodes placed on the petri dish, perfectly matching the M-VAVE FM-1's strict 8-voice polyphony ceiling.
//    - Protoplasmic vein flux accumulates at food nodes; threshold crossings trigger peristaltic contractile note pulses.
// 4. Scale Quantization & Pitch Mapping:
//    - Food coordinates map to scale degrees (X axis) and octave shifts (Y axis) via js/scale.js.
// 5. Continuous Timbre CC #74 Brightness Modulation:
//    - Network connectivity and global protoplasmic flux drive CC #74 via dispatchTimbreCc().
// 6. Direct Manipulation Flat Workbench Visualizer:
//    - Interactive canvas: click/drag food nodes to dynamically reroute slime mould highways in real time;
//      click to add or remove nutrient nodes.
// 7. Strict 8-Voice Ceiling & Voice Allocation via js/poly.js.
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

// ---- Simulation & Grid Constants ----
export const GRID_W = 100;
export const GRID_H = 64;
export const MAX_AGENTS = 768;
export const MAX_FOOD = 8; // Strictly hardware 8 voices

// Pre-allocated TypedArrays for Pheromone Field (Zero GC Churn)
export const trailField = new Float32Array(GRID_W * GRID_H);
const diffusedField = new Float32Array(GRID_W * GRID_H);

// Pre-allocated Agent State
const agentX = new Float32Array(MAX_AGENTS);
const agentY = new Float32Array(MAX_AGENTS);
const agentAngle = new Float32Array(MAX_AGENTS);

// Food / Nutrient Oat Nodes
export const foodNodes = [];
for (let i = 0; i < MAX_FOOD; i++) {
  foodNodes.push({
    active: false,
    x: 0,
    y: 0,
    flux: 0,
    lastStrike: 0,
    scaleDeg: 0,
    octave: 0,
    pulseAnim: 0
  });
}

// Presets
export const PHYSARUM_PRESETS = [
  { id: "tokyo", name: "Tokyo Rail Hubs", desc: "Classic Tokyo metropolitan rail hub network with peripheral stations" },
  { id: "pentagon", name: "Steiner Pentagon", desc: "Symmetrical 5-node star forming Steiner minimal tree highways" },
  { id: "bipartite", name: "Bipartite Bridge", desc: "Two separated nutrient clusters connected by an exploratory isthmus" },
  { id: "hex_hub", name: "Hexagonal Ring", desc: "6 peripheral satellite nodes with a central coordination hub" },
  { id: "spiral", name: "Golden Phyllotaxis", desc: "8 nutrient oats arranged along a logarithmic Fibonacci spiral" }
];

// Runtime State
let isPhysarumPlaying = false;
let animFrameId = null;
let lastFrameTime = 0;
let stepAccumulator = 0;
let currentAgentCount = 512;
let globalFluxMetric = 0;

// UI & Canvas References
let container = null;
let canvas = null;
let ctx = null;
let dragNodeIdx = -1;

/**
 * Initialize Food Nodes according to preset configuration.
 */
export function initFoodPreset(presetId = state.physarumPreset || "tokyo") {
  for (let i = 0; i < MAX_FOOD; i++) {
    foodNodes[i].active = false;
    foodNodes[i].flux = 0;
    foodNodes[i].pulseAnim = 0;
  }

  if (presetId === "tokyo") {
    // 6 Nodes: Central Tokyo + 5 major hub stations (Shinjuku, Shibuya, Ikebukuro, Shinagawa, Ueno)
    const pts = [
      { x: 50, y: 32, deg: 0, oct: 0 },
      { x: 34, y: 26, deg: 2, oct: 0 },
      { x: 36, y: 44, deg: 4, oct: 0 },
      { x: 44, y: 16, deg: 5, oct: 1 },
      { x: 58, y: 48, deg: 7, oct: 0 },
      { x: 66, y: 22, deg: 9, oct: 1 }
    ];
    pts.forEach((p, i) => {
      foodNodes[i].active = true;
      foodNodes[i].x = p.x;
      foodNodes[i].y = p.y;
      foodNodes[i].scaleDeg = p.deg;
      foodNodes[i].octave = p.oct;
    });
  } else if (presetId === "pentagon") {
    // 5 Nodes: Regular Steiner Pentagon
    const r = 22;
    for (let i = 0; i < 5; i++) {
      const angle = (i * Math.PI * 2) / 5 - Math.PI / 2;
      foodNodes[i].active = true;
      foodNodes[i].x = Math.round(50 + Math.cos(angle) * r);
      foodNodes[i].y = Math.round(32 + Math.sin(angle) * r);
      foodNodes[i].scaleDeg = i * 2;
      foodNodes[i].octave = i % 2;
    }
  } else if (presetId === "bipartite") {
    // 6 Nodes: 3 West, 3 East
    const pts = [
      { x: 22, y: 20, deg: 0, oct: 0 },
      { x: 22, y: 44, deg: 2, oct: 0 },
      { x: 30, y: 32, deg: 4, oct: 0 },
      { x: 70, y: 32, deg: 5, oct: 1 },
      { x: 78, y: 20, deg: 7, oct: 1 },
      { x: 78, y: 44, deg: 9, oct: 1 }
    ];
    pts.forEach((p, i) => {
      foodNodes[i].active = true;
      foodNodes[i].x = p.x;
      foodNodes[i].y = p.y;
      foodNodes[i].scaleDeg = p.deg;
      foodNodes[i].octave = p.oct;
    });
  } else if (presetId === "hex_hub") {
    // 7 Nodes: 6 peripheral + 1 center
    foodNodes[0].active = true;
    foodNodes[0].x = 50;
    foodNodes[0].y = 32;
    foodNodes[0].scaleDeg = 0;
    foodNodes[0].octave = 0;

    const r = 24;
    for (let i = 1; i <= 6; i++) {
      const angle = ((i - 1) * Math.PI * 2) / 6;
      foodNodes[i].active = true;
      foodNodes[i].x = Math.round(50 + Math.cos(angle) * r);
      foodNodes[i].y = Math.round(32 + Math.sin(angle) * r);
      foodNodes[i].scaleDeg = (i * 2) % 12;
      foodNodes[i].octave = Math.floor(i / 3);
    }
  } else if (presetId === "spiral") {
    // 8 Nodes: Golden Logarithmic Spiral (8 Hardware Voices)
    for (let i = 0; i < 8; i++) {
      const theta = i * 1.8;
      const r = 6 + i * 3.2;
      foodNodes[i].active = true;
      foodNodes[i].x = Math.max(4, Math.min(GRID_W - 5, Math.round(50 + Math.cos(theta) * r)));
      foodNodes[i].y = Math.max(4, Math.min(GRID_H - 5, Math.round(32 + Math.sin(theta) * r)));
      foodNodes[i].scaleDeg = i;
      foodNodes[i].octave = Math.floor(i / 4);
    }
  }
}

/**
 * Randomize chemoattractant trail field using 2D Perlin noise.
 */
export function randomizePhysarum() {
  fillPerlin2D(trailField, GRID_W, GRID_H, {
    scale: 0.08,
    octaves: 3,
    persistence: 0.5,
    lacunarity: 2.0,
    min: 0.0,
    max: 1.0,
    threshold: 0.42,
    thresholdMin: 0.0,
    power: 1.4
  });
  diffusedField.set(trailField);
  status("Randomised chemoattractant trail field with Perlin noise", "ok");
  if (canvas) renderCanvas();
}

/**
 * Re-seed the agent population randomly around active food sources.
 */
export function reseedAgents(count = currentAgentCount) {
  currentAgentCount = Math.max(64, Math.min(MAX_AGENTS, count));
  trailField.fill(0);
  diffusedField.fill(0);

  // Identify active food sources to spawn near
  const activeFood = foodNodes.filter(f => f.active);

  for (let i = 0; i < currentAgentCount; i++) {
    if (activeFood.length > 0) {
      // Spawn within small cluster near one of the food nodes
      const targetFood = activeFood[i % activeFood.length];
      const r = Math.random() * 8.0;
      const th = Math.random() * Math.PI * 2;
      agentX[i] = Math.max(2, Math.min(GRID_W - 3, targetFood.x + Math.cos(th) * r));
      agentY[i] = Math.max(2, Math.min(GRID_H - 3, targetFood.y + Math.sin(th) * r));
    } else {
      agentX[i] = Math.random() * (GRID_W - 4) + 2;
      agentY[i] = Math.random() * (GRID_H - 4) + 2;
    }
    agentAngle[i] = Math.random() * Math.PI * 2;
  }
}

/**
 * Sample pheromone trail value with bilinear interpolation and toroidal/clamped boundaries.
 */
export function sampleTrail(x, y) {
  const gx = Math.max(0, Math.min(GRID_W - 1, Math.round(x)));
  const gy = Math.max(0, Math.min(GRID_H - 1, Math.round(y)));
  return trailField[gy * GRID_W + gx];
}

/**
 * Calculate pitch for a given food node.
 */
export function getFoodNodeNote(node) {
  const intervals = getActiveScaleIntervals();
  const root = getRootMidi();
  const span = Math.min(4, Math.max(1, Number(state.physarumSpan ?? 2)));

  // X coordinate maps to scale degree
  const normX = Math.max(0, Math.min(1, node.x / GRID_W));
  const numDeg = intervals.length || 7;
  const deg = Math.floor(normX * numDeg) % numDeg;

  // Y coordinate maps to octave shift
  const normY = Math.max(0, Math.min(1, 1 - (node.y / GRID_H))); // Invert so higher is higher pitch
  const oct = Math.min(span, Math.floor(normY * (span + 1)));

  const rawMidi = root + oct * 12 + (intervals[deg] ?? 0);
  return quantize(rawMidi, intervals, root);
}

/**
 * Execute simulation step: multi-agent steering, nutrient flux accumulation, note triggers,
 * and 2D trail diffusion/evaporation.
 */
export function stepSimulation(dt = 16) {
  const speedMult = Math.max(0.1, Number(state.modelSpeed ?? 1.0));
  const effectiveDt = (dt / 16) * speedMult;

  const sensorDist = Math.max(1.0, Math.min(12.0, Number(state.physarumSensorDist ?? 4.0)));
  const sensorAngle = (Math.max(15, Math.min(90, Number(state.physarumSensorAngle ?? 35))) * Math.PI) / 180;
  const decay = Math.max(0.80, Math.min(0.99, Number(state.physarumDecay ?? 0.94)));
  const fluxThreshold = Math.max(5.0, Math.min(60.0, Number(state.physarumThreshold ?? 18.0)));
  const depositAmt = Math.max(0.5, Math.min(5.0, Number(state.physarumDeposit ?? 1.8)));

  // 1. Agent Sensory Steering & Movement
  for (let i = 0; i < currentAgentCount; i++) {
    const a = agentAngle[i];
    const x = agentX[i];
    const y = agentY[i];

    // Sample Forward, Left (+sensorAngle), and Right (-sensorAngle)
    const fX = x + Math.cos(a) * sensorDist;
    const fY = y + Math.sin(a) * sensorDist;
    const lX = x + Math.cos(a + sensorAngle) * sensorDist;
    const lY = y + Math.sin(a + sensorAngle) * sensorDist;
    const rX = x + Math.cos(a - sensorAngle) * sensorDist;
    const rY = y + Math.sin(a - sensorAngle) * sensorDist;

    const fC = sampleTrail(fX, fY);
    const lC = sampleTrail(lX, lY);
    const rC = sampleTrail(rX, rY);

    if (fC > lC && fC > rC) {
      // Continue straight ahead with micro jitter
      agentAngle[i] += (Math.random() - 0.5) * 0.1;
    } else if (lC > rC) {
      // Steer left
      agentAngle[i] += 0.35 + (Math.random() - 0.5) * 0.1;
    } else if (rC > lC) {
      // Steer right
      agentAngle[i] -= 0.35 + (Math.random() - 0.5) * 0.1;
    } else {
      // Wandering exploratory brownian drift
      agentAngle[i] += (Math.random() - 0.5) * 0.6;
    }

    // Step forward
    const stepSize = 1.4 * effectiveDt;
    let nextX = x + Math.cos(agentAngle[i]) * stepSize;
    let nextY = y + Math.sin(agentAngle[i]) * stepSize;

    // Bounce off boundary walls
    if (nextX < 1) { nextX = 1; agentAngle[i] = Math.PI - agentAngle[i]; }
    else if (nextX >= GRID_W - 1) { nextX = GRID_W - 2; agentAngle[i] = Math.PI - agentAngle[i]; }

    if (nextY < 1) { nextY = 1; agentAngle[i] = -agentAngle[i]; }
    else if (nextY >= GRID_H - 1) { nextY = GRID_H - 2; agentAngle[i] = -agentAngle[i]; }

    agentX[i] = nextX;
    agentY[i] = nextY;

    // Deposit trail chemoattractant onto grid
    const ix = Math.floor(nextX);
    const iy = Math.floor(nextY);
    const gridIdx = iy * GRID_W + ix;
    trailField[gridIdx] += depositAmt * effectiveDt;
  }

  // 2. Food Sources Nutrient Deposition & Peristaltic Flux Check
  let activeNodesCount = 0;
  let totalNetworkFlux = 0;

  for (let f = 0; f < MAX_FOOD; f++) {
    const node = foodNodes[f];
    if (!node.active) continue;
    activeNodesCount++;

    const fx = Math.max(0, Math.min(GRID_W - 1, node.x));
    const fy = Math.max(0, Math.min(GRID_H - 1, node.y));
    const centerIdx = fy * GRID_W + fx;

    // Continual nutrient attractant emitted by food oats
    trailField[centerIdx] += 10.0 * effectiveDt;
    if (fx > 0) trailField[centerIdx - 1] += 5.0 * effectiveDt;
    if (fx < GRID_W - 1) trailField[centerIdx + 1] += 5.0 * effectiveDt;
    if (fy > 0) trailField[centerIdx - GRID_W] += 5.0 * effectiveDt;
    if (fy < GRID_H - 1) trailField[centerIdx + GRID_W] += 5.0 * effectiveDt;

    // Local biomass density calculation (3x3 kernel around node)
    let localBiomass = 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = Math.max(0, Math.min(GRID_W - 1, fx + dx));
        const ny = Math.max(0, Math.min(GRID_H - 1, fy + dy));
        localBiomass += trailField[ny * GRID_W + nx];
      }
    }

    totalNetworkFlux += localBiomass;
    node.flux += localBiomass * 0.05 * effectiveDt;

    // Decay pulse animation
    if (node.pulseAnim > 0.01) {
      node.pulseAnim *= 0.88;
    } else {
      node.pulseAnim = 0;
    }

    // Trigger Peristaltic Note Pulse when Flux crosses threshold!
    if (node.flux >= fluxThreshold) {
      node.flux = 0;
      node.pulseAnim = 1.0;
      node.lastStrike = performance.now();

      if (isPhysarumPlaying) {
        const note = getFoodNodeNote(node);
        const weightRatio = Math.min(1.0, localBiomass / 120);
        const vel = Math.max(40, Math.min(127, Math.round(75 + weightRatio * 45)));
        const durMs = Math.round(220 + weightRatio * 260);

        // Dispatch voice strictly through poly.js manager (slot f, 0 to 7)
        playVoice(`physarum_${f}`, note, vel, durMs);
      }
    }
  }

  // 3. 2D Field Diffusion & Evaporation (Laplacian 4-neighbor averaging with decay)
  const decayRate = Math.pow(decay, effectiveDt);
  for (let y = 1; y < GRID_H - 1; y++) {
    const rowOffset = y * GRID_W;
    for (let x = 1; x < GRID_W - 1; x++) {
      const idx = rowOffset + x;
      // 4-neighborhood average
      const sum = trailField[idx - 1] + trailField[idx + 1] +
                  trailField[idx - GRID_W] + trailField[idx + GRID_W];
      diffusedField[idx] = sum * 0.25 * decayRate;
    }
  }

  // Copy diffused values back to trailField (typed array set)
  trailField.set(diffusedField);

  // 4. Continuous Timbre Modulation (CC #74) driven by network connectivity
  if (activeNodesCount > 0) {
    const avgFluxPerNode = totalNetworkFlux / activeNodesCount;
    const normConnectivity = Math.min(1.0, avgFluxPerNode / 150);
    globalFluxMetric = normConnectivity;
    dispatchTimbreCc(normConnectivity, 0.5, 200);
  }
}

/**
 * Render Physarum petri dish: 2D vein luminescence, agent particles, and food nutrient hubs.
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

  // 1. Draw Pheromone Trail Veins (Flat block cells with dynamic alpha)
  for (let y = 0; y < GRID_H; y += 2) {
    const rowOffset = y * GRID_W;
    for (let x = 0; x < GRID_W; x += 2) {
      const val = trailField[rowOffset + x];
      if (val > 0.8) {
        const intensity = Math.min(1.0, val / 15.0);
        ctx.fillStyle = colorAccent;
        ctx.globalAlpha = intensity * 0.65;
        ctx.fillRect(x * scaleX, y * scaleY, scaleX * 2, scaleY * 2);
      }
    }
  }
  ctx.globalAlpha = 1.0;

  // 2. Draw Agent Particles
  ctx.fillStyle = colorFg;
  ctx.globalAlpha = 0.55;
  for (let i = 0; i < currentAgentCount; i += 2) {
    const ax = agentX[i] * scaleX;
    const ay = agentY[i] * scaleY;
    ctx.fillRect(ax - 0.75, ay - 0.75, 1.5, 1.5);
  }
  ctx.globalAlpha = 1.0;

  // 3. Draw Food / Nutrient Oat Nodes
  for (let f = 0; f < MAX_FOOD; f++) {
    const node = foodNodes[f];
    if (!node.active) continue;

    const nx = node.x * scaleX;
    const ny = node.y * scaleY;
    const pulse = node.pulseAnim;

    // Resonant pulse excitation ring on note strike
    if (pulse > 0.05) {
      ctx.strokeStyle = colorOk;
      ctx.lineWidth = 1 + pulse * 2.5;
      ctx.beginPath();
      ctx.arc(nx, ny, 10 + (1.0 - pulse) * 16, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Outer node body
    ctx.fillStyle = pulse > 0.05 ? colorOk : colorPanel2;
    ctx.strokeStyle = pulse > 0.05 ? colorFg : colorLineFocus;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(nx, ny, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Inner nutrient core
    const fluxPct = Math.min(1.0, node.flux / Math.max(1, Number(state.physarumThreshold ?? 18.0)));
    ctx.fillStyle = colorAccent;
    ctx.beginPath();
    ctx.arc(nx, ny, 2.5 + fluxPct * 3.5, 0, Math.PI * 2);
    ctx.fill();

    // Node label: Voice ID and Note Name
    const noteMidi = getFoodNodeNote(node);
    const label = `${midiName(noteMidi)}`;
    ctx.font = "bold 9px monospace";
    ctx.fillStyle = pulse > 0.05 ? colorOk : colorFg;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, nx, ny - 13);

    // Voice number
    ctx.font = "8px monospace";
    ctx.fillStyle = colorDim;
    ctx.fillText(`V${f + 1}`, nx, ny + 13);
  }

  // 4. Header Overlay Status Bar
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.font = "10px monospace";
  ctx.fillStyle = colorDim;
  ctx.fillText("PHYSARUM STEINER TRANSPORT NETWORK", 12, 16);

  const activeCount = foodNodes.filter(n => n.active).length;
  ctx.textAlign = "right";
  ctx.fillText(`ACTIVE VOICES: ${activeCount}/8 | AGENTS: ${currentAgentCount} | FLUX: ${(globalFluxMetric * 100).toFixed(0)}%`, w - 12, 16);
}

/**
 * Animation frame loop.
 */
function animationTick(now) {
  if (!lastFrameTime) lastFrameTime = now;
  const dt = Math.min(100, now - lastFrameTime);
  lastFrameTime = now;

  if (isPhysarumPlaying) {
    stepSimulation(dt);
  }

  renderCanvas();
  if (typeof requestAnimationFrame === "function") {
    animFrameId = requestAnimationFrame(animationTick);
  }
}

/**
 * Direct canvas interaction: Drag food nodes to reroute veins; click to add/remove food nodes.
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

    // Check if clicked near an existing food node
    dragNodeIdx = -1;
    for (let f = 0; f < MAX_FOOD; f++) {
      const node = foodNodes[f];
      if (!node.active) continue;
      const dist = Math.hypot(node.x - gx, node.y - gy);
      if (dist <= 6.0) {
        dragNodeIdx = f;
        break;
      }
    }

    // Shift-click removes node
    if (e.shiftKey && dragNodeIdx !== -1) {
      foodNodes[dragNodeIdx].active = false;
      status(`Removed Food Oat Node V${dragNodeIdx + 1}`);
      dragNodeIdx = -1;
      renderCanvas();
      return;
    }

    // If clicked empty space, add a new food node (up to MAX_FOOD)
    if (dragNodeIdx === -1 && !e.shiftKey) {
      const availableIdx = foodNodes.findIndex(n => !n.active);
      if (availableIdx !== -1) {
        foodNodes[availableIdx].active = true;
        foodNodes[availableIdx].x = Math.max(3, Math.min(GRID_W - 4, Math.round(gx)));
        foodNodes[availableIdx].y = Math.max(3, Math.min(GRID_H - 4, Math.round(gy)));
        foodNodes[availableIdx].flux = 0;
        foodNodes[availableIdx].pulseAnim = 1.0;
        status(`Added Food Oat Node V${availableIdx + 1} at [${foodNodes[availableIdx].x}, ${foodNodes[availableIdx].y}]`);
        renderCanvas();
      } else {
        status("Maximum 8 voices reached (FM-1 hardware limit)", "warn");
      }
    }
  });

  window.addEventListener("mousemove", (e) => {
    if (dragNodeIdx === -1) return;
    const { gx, gy } = getCanvasCoords(e);
    foodNodes[dragNodeIdx].x = Math.max(3, Math.min(GRID_W - 4, Math.round(gx)));
    foodNodes[dragNodeIdx].y = Math.max(3, Math.min(GRID_H - 4, Math.round(gy)));
    renderCanvas();
  });

  window.addEventListener("mouseup", () => {
    if (dragNodeIdx !== -1) {
      status(`Repositioned Food Node V${dragNodeIdx + 1} -> Veins will dynamically reroute!`);
      dragNodeIdx = -1;
    }
  });
}

/**
 * Generator Function Contract: generatePhysarumBank(state).
 * Returns a valid bank array of pattern objects for 64-step sync mode.
 */
export function generatePhysarumBank(stateObj) {
  const seqLen = stateObj?.length || 64;
  const rateIdx = stateObj?.rate !== undefined ? stateObj.rate : 3;

  // Collect active food nodes
  const activeNodes = foodNodes.filter(n => n.active);
  const steps = [];

  for (let s = 0; s < seqLen; s++) {
    if (activeNodes.length === 0) {
      steps.push({
        note: 60,
        vel: 80,
        notes: [],
        gate: 0,
        accent: 0,
        slide: 0,
        pitchMidi: 60,
        source: "physarum"
      });
      continue;
    }

    // Step cycle through food nodes
    const node = activeNodes[s % activeNodes.length];
    const note = getFoodNodeNote(node);
    const isDownbeat = (s % 8 === 0);

    steps.push({
      note,
      vel: isDownbeat ? 110 : 85,
      notes: [{ note, vel: isDownbeat ? 110 : 85 }],
      gate: 1,
      accent: isDownbeat ? 1 : 0,
      slide: 0,
      pitchMidi: note,
      source: "physarum",
      foodIdx: s % activeNodes.length
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
export function isPhysarumRunning() {
  return isPhysarumPlaying;
}

export function startPhysarum() {
  if (isPhysarumPlaying) return;
  isPhysarumPlaying = true;
  audio.unlock();
  updatePlayBtnUI();
  status("Physarum Network: Slime mould foraging · Transport active", "ok");
}

export function stopPhysarum() {
  isPhysarumPlaying = false;
  releasePolyVoices();
  updatePlayBtnUI();
  status("Physarum Network: Stopped", "warn");
}

export function togglePhysarumRunning() {
  if (isPhysarumPlaying) stopPhysarum();
  else startPhysarum();
}

function updatePlayBtnUI() {
  const btn = document.getElementById("physarum-play-btn");
  if (!btn) return;
  btn.textContent = isPhysarumPlaying ? "Stop" : "Play";
  btn.className = isPhysarumPlaying ? "btn btn-err" : "btn btn-ok";
}

/**
 * Model Activation / Deactivation Lifecycle
 */
export function activatePhysarumModel() {
  setModelGenerator(generatePhysarumBank);
  setModelRandomizer(randomizePhysarum);
  setModelStepHandler((stepIdx) => {
    // SYNC mode transport step: execute one simulation pulse
    stepSimulation(32);
    renderCanvas();
  });
  setModelTransportHandler({
    start: startPhysarum,
    stop: stopPhysarum,
    toggle: togglePhysarumRunning,
    isRunning: isPhysarumRunning
  });

  lastFrameTime = performance.now();
  if (!animFrameId && typeof requestAnimationFrame === "function") {
    animFrameId = requestAnimationFrame(animationTick);
  }
}

export function deactivatePhysarumModel() {
  setModelGenerator(null);
  setModelRandomizer(null);
  setModelStepHandler(null);
  setModelTransportHandler(null);
  isPhysarumPlaying = false;
  releasePolyVoices();

  if (animFrameId && typeof cancelAnimationFrame === "function") {
    cancelAnimationFrame(animFrameId);
    animFrameId = null;
  }
}

/**
 * Initialize the Physarum UI and workbench enclosure.
 */
export function initPhysarum() {
  container = document.getElementById("model-physarum");
  if (!container) return;

  container.innerHTML = `
    <div class="physarum-enclosure">
      <!-- Top Control Bar -->
      <div class="physarum-controls" style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-bottom: 8px;">
        <button id="physarum-play-btn" class="btn btn-ok" style="min-width: 60px;">Play</button>
        <button id="physarum-rnd-btn" class="btn" title="Randomise trail field with Perlin noise">RND</button>
        <button id="physarum-reseed-btn" class="btn" title="Re-seed swarm around active food hubs">Re-Seed</button>
        <button id="physarum-clear-btn" class="btn" title="Clear all trails">Clear</button>

        <label style="font-size: 11px; color: var(--dim); display: flex; align-items: center; gap: 4px;">
          Preset:
          <select id="physarum-preset-select" class="select-field" style="padding: 2px 4px; font-size: 11px;">
            ${PHYSARUM_PRESETS.map(p => `<option value="${p.id}" ${p.id === (state.physarumPreset || "tokyo") ? "selected" : ""}>${p.name}</option>`).join("")}
          </select>
        </label>

        <label style="font-size: 11px; color: var(--dim); display: flex; align-items: center; gap: 4px;" title="Agent Sensor Distance">
          Sens Dist:
          <input type="range" id="physarum-sens-dist" min="2" max="10" step="0.5" value="${state.physarumSensorDist ?? 4}" style="width: 70px;">
        </label>

        <label style="font-size: 11px; color: var(--dim); display: flex; align-items: center; gap: 4px;" title="Sensor Heading Angle (degrees)">
          Sens Ang:
          <input type="range" id="physarum-sens-ang" min="20" max="60" step="5" value="${state.physarumSensorAngle ?? 35}" style="width: 70px;">
        </label>

        <label style="font-size: 11px; color: var(--dim); display: flex; align-items: center; gap: 4px;" title="Pheromone Decay Factor">
          Decay:
          <input type="range" id="physarum-decay" min="0.85" max="0.98" step="0.01" value="${state.physarumDecay ?? 0.94}" style="width: 70px;">
        </label>

        <label style="font-size: 11px; color: var(--dim); display: flex; align-items: center; gap: 4px;" title="Contractile Flux Note Threshold">
          Thresh:
          <input type="range" id="physarum-thresh" min="8" max="40" step="2" value="${state.physarumThreshold ?? 18}" style="width: 70px;">
        </label>

        <label style="font-size: 11px; color: var(--dim); display: flex; align-items: center; gap: 4px;" title="Agent Swarm Population">
          Agents:
          <input type="range" id="physarum-agents" min="128" max="768" step="64" value="${state.physarumAgents ?? 512}" style="width: 70px;">
        </label>

        <label style="font-size: 11px; color: var(--dim); display: flex; align-items: center; gap: 4px;" title="Pitch Octave Span">
          Span:
          <input type="range" id="physarum-span" min="1" max="4" step="1" value="${state.physarumSpan ?? 2}" style="width: 50px;">
        </label>
      </div>

      <!-- Canvas Petri Dish -->
      <div style="position: relative; width: 100%; border: 1px solid var(--line); background: var(--panel);">
        <canvas id="physarum-canvas" width="800" height="420" style="width: 100%; height: auto; display: block;"></canvas>
      </div>
      <div style="font-size: 10px; color: var(--dim); margin-top: 4px; display: flex; justify-content: space-between;">
        <span>Direct Manipulation: Click empty space to add food oat node (max 8) · Drag to move · Shift-click to remove</span>
        <span>Jeff Jones Multi-Agent Chemotaxis Engine · Strict 8-Voice Hardware Ceiling</span>
      </div>
    </div>
  `;

  canvas = document.getElementById("physarum-canvas");
  if (canvas) {
    ctx = canvas.getContext("2d");
    setupCanvasInteraction();
  }

  // Hook button listeners
  const playBtn = document.getElementById("physarum-play-btn");
  if (playBtn) playBtn.addEventListener("click", togglePhysarumRunning);

  const rndBtn = document.getElementById("physarum-rnd-btn");
  if (rndBtn) rndBtn.addEventListener("click", () => {
    randomizePhysarum();
  });

  const reseedBtn = document.getElementById("physarum-reseed-btn");
  if (reseedBtn) reseedBtn.addEventListener("click", () => {
    reseedAgents();
    renderCanvas();
    status("Re-seeded physarum agents around food hubs");
  });

  const clearBtn = document.getElementById("physarum-clear-btn");
  if (clearBtn) clearBtn.addEventListener("click", () => {
    trailField.fill(0);
    diffusedField.fill(0);
    renderCanvas();
    status("Cleared pheromone trail field");
  });

  setModelRandomizer(randomizePhysarum);

  const presetSelect = document.getElementById("physarum-preset-select");
  if (presetSelect) {
    presetSelect.addEventListener("change", (e) => {
      setState({ physarumPreset: e.target.value });
      initFoodPreset(e.target.value);
      reseedAgents();
      renderCanvas();
      status(`Loaded Physarum Preset: ${e.target.value}`);
    });
  }

  // Hook range input sliders
  const bindSlider = (id, stateKey, onChange) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener("input", (e) => {
      const val = parseFloat(e.target.value);
      setState({ [stateKey]: val });
      if (onChange) onChange(val);
    });
  };

  bindSlider("physarum-sens-dist", "physarumSensorDist");
  bindSlider("physarum-sens-ang", "physarumSensorAngle");
  bindSlider("physarum-decay", "physarumDecay");
  bindSlider("physarum-thresh", "physarumThreshold");
  bindSlider("physarum-span", "physarumSpan");
  bindSlider("physarum-agents", "physarumAgents", (val) => {
    reseedAgents(val);
  });

  // Initialize initial preset and agents
  initFoodPreset(state.physarumPreset || "tokyo");
  reseedAgents(Number(state.physarumAgents ?? 512));
  renderCanvas();
}

// ---- Register Snapshot Serialization Contract ----
registerModel({
  id: "physarum",
  version: 1,
  migrations: {},
  capture() {
    return {
      preset: state.physarumPreset || "tokyo",
      sensorDist: state.physarumSensorDist ?? 4.0,
      sensorAngle: state.physarumSensorAngle ?? 35,
      decay: state.physarumDecay ?? 0.94,
      threshold: state.physarumThreshold ?? 18.0,
      agents: state.physarumAgents ?? 512,
      span: state.physarumSpan ?? 2,
      foodNodes: foodNodes.map(n => ({
        active: n.active,
        x: n.x,
        y: n.y,
        scaleDeg: n.scaleDeg,
        octave: n.octave
      }))
    };
  },
  restore(data) {
    if (!data) return;
    if (data.preset) setState({ physarumPreset: data.preset });
    if (data.sensorDist !== undefined) setState({ physarumSensorDist: data.sensorDist });
    if (data.sensorAngle !== undefined) setState({ physarumSensorAngle: data.sensorAngle });
    if (data.decay !== undefined) setState({ physarumDecay: data.decay });
    if (data.threshold !== undefined) setState({ physarumThreshold: data.threshold });
    if (data.agents !== undefined) setState({ physarumAgents: data.agents });
    if (data.span !== undefined) setState({ physarumSpan: data.span });

    if (Array.isArray(data.foodNodes)) {
      for (let i = 0; i < MAX_FOOD; i++) {
        if (data.foodNodes[i]) {
          foodNodes[i].active = !!data.foodNodes[i].active;
          foodNodes[i].x = data.foodNodes[i].x;
          foodNodes[i].y = data.foodNodes[i].y;
          foodNodes[i].scaleDeg = data.foodNodes[i].scaleDeg;
          foodNodes[i].octave = data.foodNodes[i].octave;
          foodNodes[i].flux = 0;
          foodNodes[i].pulseAnim = 0;
        }
      }
    }
    reseedAgents(Number(state.physarumAgents ?? 512));
    renderCanvas();
  }
});
