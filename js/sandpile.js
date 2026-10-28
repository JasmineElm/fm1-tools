// sandpile.js — Bak-Tang-Wiesenfeld Abelian Sandpile (SOC) for FM-1 Pulses.
// Physical statistical avalanche simulator governed by Self-Organized Criticality (SOC).
//
// Generative Architecture:
// 1. 2D square integer lattice (z(x, y) grains per cell, capacity threshold = 4).
// 2. Sand grain deposition streams into the lattice (center sink, 4 corners, cross, rain, spiral).
// 3. Toppling rule: if z(x,y) >= 4, cell loses 4 grains and distributes 1 grain to each cardinal neighbor.
// 4. Boundary dissipation: Open boundary (energy sink, canonical BTW SOC), Closed (reflective), or Wrap (torus).
// 5. Relaxation queue: avalanches cascade across all spatial scales following a 1/f pink noise power law.
// 6. Center-of-mass polyphonic pitch mapping: radial distance, quadrant chords, arpeggio cascades, or avalanche energy.
// 7. Strict <= 8-voice polyphony ceiling with FIFO note-stealing for M-VAVE FM-1 hardware.
// 8. Continuous FM-1 CC #74 Brightness modulation reflecting instantaneous avalanche kinetic power.
// 9. Dual Sync/Free modes: 64-step transport-locked grid sequence or continuous real-time avalanche physics.

import {
  state, refs, R, setState, scheduleRegen, doGenerate,
  getBank, setBank, getSelected, setSelected, status, onRegen,
  setModelGenerator, setModelRandomizer, RATE_NAMES
} from "./state.js";
import { knob, dropdown } from "./controls.js";
import { isLive, setModelStepHandler, setModelTransportHandler } from "./player.js?v=1";
import { liveNoteOn, liveNoteOff, panicPreview, dispatchTimbreCc } from "./player.js";
import { SCALE_LABELS, ROOT_NOTE_OPTIONS, ROOT_OCTAVE_OPTIONS, mapNormalizedToNote, getRootMidi, getActiveScaleIntervals, computeOctaveShift } from "./scale.js?v=1";
import { syncRhythmGrid } from "./rhythm.js";
import { getActiveModel } from "./modes.js";
import { quantize, midiName, SCALES } from "./generator.js";
import { registerModel } from "./snapshot.js";
import { selectPolyVoices, playVoice, releasePolyVoices, getActiveVoiceCount } from "./poly.js";
import * as midi from "./midi.js";
import * as audio from "./audio.js";

// ---- Constants & Pre-allocated TypedArray Buffers (Zero GC Churn) ----
const MAX_GRID_SIZE = 65;
const MAX_CELLS = MAX_GRID_SIZE * MAX_GRID_SIZE;
const MAX_VOICES = 8;

// Lattice buffers
const grid = new Int16Array(MAX_CELLS);
const toppleMark = new Uint8Array(MAX_CELLS);
const Q_SIZE = 65536;
const Q_MASK = Q_SIZE - 1;
const toppleQueue = new Int32Array(Q_SIZE);
let qHead = 0;
let qTail = 0;

function queueTopple(idx) {
  if (!toppleMark[idx]) {
    toppleMark[idx] = 1;
    toppleQueue[qTail & Q_MASK] = idx;
    qTail++;
  }
}

// Ripple animation buffers
const MAX_RIPPLES = 12;
const rippleX = new Float32Array(MAX_RIPPLES);
const rippleY = new Float32Array(MAX_RIPPLES);
const rippleRadius = new Float32Array(MAX_RIPPLES);
const rippleMaxRadius = new Float32Array(MAX_RIPPLES);
const rippleAlpha = new Float32Array(MAX_RIPPLES);
const rippleColor = new Array(MAX_RIPPLES).fill("#00f0ff");
let rippleHead = 0;

// Active topple flashes for visual sparkle
const flashLife = new Float32Array(MAX_CELLS);

// Avalanche sweep cell tracking & voice allocation (zero GC churn)
const toppleSites = new Int32Array(MAX_CELLS);
const toppleCounts = new Int16Array(MAX_CELLS);
let toppleSiteCount = 0;

const sortIndices = new Int32Array(MAX_CELLS);
const sortMetrics = new Float32Array(MAX_CELLS);
const chosenCellIndices = new Int32Array(MAX_VOICES);
const chosenPitches = new Int32Array(MAX_VOICES);

// 8-Voice FIFO voice slot index
let voiceCounter = 0;

// Simulation & Transport State
let isSandpilePlaying = false;
let animFrameId = null;
let lastFrameTime = 0;
let dropAccumulator = 0;
let spiralAngle = 0;
let cornerStep = 0;

// Metric tracking
let totalGrains = 0;
let totalAvalanches = 0;
let lastAvalancheSize = 0;
let peakAvalancheSize = 0;
let activeToppleCount = 0;
let currentComX = 16;
let currentComY = 16;
let comAlpha = 0;

// DOM & Canvas elements
let sandpileContainer = null;
let sandpileCanvas = null;
let presetSelect = null;
let statReadoutEl = null;

// Presets
export const SANDPILE_PRESETS = [
  { id: "empty", name: "Empty Lattice", desc: "Clean slate, starts at zero grains" },
  { id: "critical", name: "Critical State (z=3)", desc: "Uniformly filled with 3 grains; on the verge of massive cascades" },
  { id: "pyramid", name: "Central Pyramid", desc: "Concentric gradient of sand grains decreasing toward borders" },
  { id: "checker", name: "Checkerboard", desc: "Alternating 3-1-3-1 lattice pattern" },
  { id: "apollonian", name: "Apollonian Gasket", desc: "Massive central sandpile (4,000 grains) creating fractal geometry" }
];

// ---- Voice Allocation & Audio Dispatch (Strictly <= 8 Voices via js/poly.js) ----
function playSandpileVoice(voiceId, note, vel, durMs) {
  playVoice(voiceId, note, vel, durMs);
}

function releaseAllVoices() {
  releasePolyVoices();
}

// ---- Lattice Management & Initialization ----
export function initSandpileGrid(presetId = state.sandpilePreset || "empty") {
  const S = Math.min(MAX_GRID_SIZE, Math.max(15, state.sandpileGridSize ?? 33));
  const total = S * S;
  grid.fill(0);
  toppleMark.fill(0);
  flashLife.fill(0);
  qHead = 0;
  qTail = 0;
  totalGrains = 0;
  lastAvalancheSize = 0;
  activeToppleCount = 0;
  currentComX = Math.floor(S / 2);
  currentComY = Math.floor(S / 2);

  const cx = Math.floor(S / 2);
  const cy = Math.floor(S / 2);

  if (presetId === "critical") {
    for (let i = 0; i < total; i++) {
      grid[i] = 3;
    }
    totalGrains = total * 3;
  } else if (presetId === "pyramid") {
    const maxR = Math.floor(S / 2);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const d = Math.max(Math.abs(x - cx), Math.abs(y - cy));
        const z = Math.max(0, Math.min(3, Math.round(3 * (1 - d / maxR))));
        const idx = y * S + x;
        grid[idx] = z;
        totalGrains += z;
      }
    }
  } else if (presetId === "checker") {
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const idx = y * S + x;
        const z = (x + y) % 2 === 0 ? 3 : 1;
        grid[idx] = z;
        totalGrains += z;
      }
    }
  } else if (presetId === "apollonian") {
    const idx = cy * S + cx;
    const initialPile = 4000;
    grid[idx] = initialPile;
    totalGrains = initialPile;
    queueTopple(idx);
    // Pre-relax partially so the fractal pattern emerges
    runAvalancheCascade(2400, false);
  }
}

// Add grains to cell (x, y)
export function dropGrains(x, y, amount = 1) {
  const S = Math.min(MAX_GRID_SIZE, Math.max(15, state.sandpileGridSize ?? 33));
  if (x < 0 || x >= S || y < 0 || y >= S) return;
  const idx = y * S + x;
  grid[idx] += amount;
  totalGrains += amount;
  flashLife[idx] = 1.0;

  if (grid[idx] >= 4) {
    queueTopple(idx);
  }
}

// Get coordinate for deposition pattern
function getDropCoordinate(pattern, S) {
  const cx = Math.floor(S / 2);
  const cy = Math.floor(S / 2);

  switch (pattern) {
    case "corners": {
      const margin = 2;
      const corners = [
        [margin, margin],
        [S - 1 - margin, margin],
        [S - 1 - margin, S - 1 - margin],
        [margin, S - 1 - margin]
      ];
      cornerStep = (cornerStep + 1) % 4;
      return corners[cornerStep];
    }
    case "cross": {
      const offset = 4;
      const pts = [
        [cx, cy],
        [cx, cy - offset],
        [cx + offset, cy],
        [cx, cy + offset],
        [cx - offset, cy]
      ];
      cornerStep = (cornerStep + 1) % pts.length;
      return pts[cornerStep];
    }
    case "spiral": {
      spiralAngle += 0.45;
      const r = (Math.sin(spiralAngle * 0.3) * 0.35 + 0.4) * (S / 2 - 2);
      const px = Math.round(cx + Math.cos(spiralAngle) * r);
      const py = Math.round(cy + Math.sin(spiralAngle) * r);
      return [Math.max(1, Math.min(S - 2, px)), Math.max(1, Math.min(S - 2, py))];
    }
    case "random": {
      const rx = Math.floor(1 + Math.random() * (S - 2));
      const ry = Math.floor(1 + Math.random() * (S - 2));
      return [rx, ry];
    }
    case "center":
    default:
      return [cx, cy];
  }
}

// Spawn visual ripple ring
function spawnRipple(cx, cy, maxR = 40, col = "#00f0ff") {
  rippleX[rippleHead] = cx;
  rippleY[rippleHead] = cy;
  rippleRadius[rippleHead] = 2;
  rippleMaxRadius[rippleHead] = maxR;
  rippleAlpha[rippleHead] = 1.0;
  rippleColor[rippleHead] = col;
  rippleHead = (rippleHead + 1) % MAX_RIPPLES;
}

// Step topple relaxation sweep
// Returns total topples processed in this sweep
export function runAvalancheCascade(maxStepBudget = 250, dispatchAudio = true) {
  if (qHead >= qTail) return 0;

  const S = Math.min(MAX_GRID_SIZE, Math.max(15, state.sandpileGridSize ?? 33));
  const boundary = state.sandpileBoundary || "open";
  let topples = 0;
  let sumX = 0;
  let sumY = 0;
  toppleSiteCount = 0;

  while (qHead < qTail && topples < maxStepBudget) {
    const idx = toppleQueue[qHead & Q_MASK];
    qHead++;
    toppleMark[idx] = 0;

    if (grid[idx] < 4) continue;

    const numTopples = Math.floor(grid[idx] / 4);
    grid[idx] %= 4;
    topples += numTopples;

    const x = idx % S;
    const y = Math.floor(idx / S);
    sumX += x * numTopples;
    sumY += y * numTopples;
    flashLife[idx] = 1.0;

    if (toppleSiteCount < MAX_CELLS) {
      toppleSites[toppleSiteCount] = idx;
      toppleCounts[toppleSiteCount] = numTopples;
      toppleSiteCount++;
    }

    // Cardinal Neighbors: (x+1, y), (x-1, y), (x, y+1), (x, y-1)
    const neighbors = [
      [x + 1, y],
      [x - 1, y],
      [x, y + 1],
      [x, y - 1]
    ];

    for (let k = 0; k < 4; k++) {
      let nx = neighbors[k][0];
      let ny = neighbors[k][1];

      if (nx < 0 || nx >= S || ny < 0 || ny >= S) {
        if (boundary === "open") {
          // Grains dissipate off the lattice into the boundary sink (SOC canonical)
          totalGrains = Math.max(0, totalGrains - numTopples);
          continue;
        } else if (boundary === "wrap") {
          nx = (nx + S) % S;
          ny = (ny + S) % S;
        } else {
          // Closed / reflective: grain stays on edge
          nx = Math.max(0, Math.min(S - 1, nx));
          ny = Math.max(0, Math.min(S - 1, ny));
        }
      }

      const nidx = ny * S + nx;
      grid[nidx] += numTopples;
      if (grid[nidx] >= 4) {
        queueTopple(nidx);
      }
    }
  }

  // Reset indices if queue fully drained
  if (qHead >= qTail) {
    qHead = 0;
    qTail = 0;
  }

  activeToppleCount = topples;
  lastAvalancheSize += topples;
  if (lastAvalancheSize > peakAvalancheSize) {
    peakAvalancheSize = lastAvalancheSize;
  }

  if (topples > 0) {
    currentComX = sumX / topples;
    currentComY = sumY / topples;
    comAlpha = 1.0;

    if (dispatchAudio) {
      dispatchAvalancheAudio(topples, currentComX, currentComY, toppleSiteCount, S);
    }
  }

  return topples;
}

let lastAudioTriggerTime = 0;
const VOICE_COLORS = ["#00f0ff", "#ff007f", "#ffb700", "#39ff14", "#a855f7", "#38bdf8", "#f43f5e", "#eab308"];

function playDropletPing(x, y, S) {
  const root = getRootMidi();
  const intervals = getActiveScaleIntervals();
  const span = Math.min(4, Math.max(1, state.sandpileSpan ?? state.pitchSpan ?? 2));
  const cx = Math.floor(S / 2);
  const cy = Math.floor(S / 2);
  const r = Math.hypot(x - cx, y - cy);
  const normR = Math.min(1.0, r / Math.max(1, S / 2));
  const totalNotes = intervals.length * span;
  const noteIdx = Math.min(totalNotes - 1, Math.floor(normR * totalNotes));
  const octave = Math.floor(noteIdx / intervals.length);
  const deg = noteIdx % intervals.length;
  const targetPitch = root + octave * 12 + (intervals[deg] || 0);
  const note = quantize(targetPitch, intervals, root);
  playSandpileVoice(7, note, 55, 90);
  spawnRipple(x, y, 16, "#38bdf8");
}

// Extract scale-quantized pitches based on polyphony, mapping, and picker rule
function extractSandpilePitches(siteCount, S, root, intervals, span, polyphony, mapping, rule) {
  let uniqueCount = 0;
  const cx = Math.floor(S / 2);
  const cy = Math.floor(S / 2);

  for (let i = 0; i < siteCount && uniqueCount < 256; i++) {
    const idx = toppleSites[i];
    if (toppleMark[idx] === 0) {
      toppleMark[idx] = 1;
      sortIndices[uniqueCount] = idx;
      uniqueCount++;
    }
  }
  for (let i = 0; i < uniqueCount; i++) {
    toppleMark[sortIndices[i]] = 0;
  }

  if (uniqueCount === 0) {
    sortIndices[0] = cy * S + cx;
    uniqueCount = 1;
  }

  // Calculate spatial metric m in [0, 1] per unique cell and determine musical pitch
  const totalNotes = intervals.length * span;
  const candidates = [];
  for (let i = 0; i < uniqueCount; i++) {
    const idx = sortIndices[i];
    const x = idx % S;
    const y = Math.floor(idx / S);
    let m = 0.5;

    switch (mapping) {
      case "x-axis":
        m = S > 1 ? x / (S - 1) : 0.5;
        break;
      case "y-axis":
        m = S > 1 ? 1.0 - (y / (S - 1)) : 0.5;
        break;
      case "radial":
        m = Math.min(1.0, Math.hypot(x - cx, y - cy) / Math.max(1, S / 2));
        break;
      case "height":
        m = Math.min(1.0, (grid[idx] + 1) / 5);
        break;
      case "diagonal":
        m = S > 1 ? (x + (S - 1 - y)) / (2 * (S - 1)) : 0.5;
        break;
      default:
        m = S > 1 ? x / (S - 1) : 0.5;
        break;
    }

    const noteIdx = Math.min(totalNotes - 1, Math.max(0, Math.floor(m * totalNotes)));
    const octave = Math.floor(noteIdx / intervals.length);
    const deg = noteIdx % intervals.length;
    const targetPitch = root + octave * 12 + (intervals[deg] || 0);
    const note = quantize(targetPitch, intervals, root);
    candidates.push({ idx, note });
  }

  const selected = selectPolyVoices(candidates, polyphony, rule);
  const voiceCount = selected.length;
  for (let v = 0; v < voiceCount; v++) {
    chosenCellIndices[v] = selected[v].idx;
    chosenPitches[v] = selected[v].note;
  }

  return voiceCount;
}

// Dispatch scale-quantized audio events based on avalanche topology
function dispatchAvalancheAudio(toppleCount, comX, comY, siteCount, S) {
  const now = performance.now();
  if (now - lastAudioTriggerTime < 35) return;
  lastAudioTriggerTime = now;

  const root = getRootMidi();
  const intervals = getActiveScaleIntervals();
  const span = Math.min(4, Math.max(1, state.sandpileSpan ?? state.pitchSpan ?? 2));
  const mapping = state.sandpilePitchMapping || "x-axis";
  const rule = state.polyStrategy || state.sandpileCellRule || "extrema";
  const polyphony = Math.min(MAX_VOICES, Math.max(1, state.polyphony ?? state.sandpilePolyphony ?? 4));
  const gateLen = state.sandpileGateLen ?? 180;
  const baseVel = state.sandpileVelocity ?? 90;

  // Kinetic velocity scaling: log2 of avalanche intensity
  const vel = Math.min(127, Math.max(35, Math.round(baseVel * 0.7 + Math.log2(toppleCount + 1) * 8)));

  const voiceCount = extractSandpilePitches(siteCount, S, root, intervals, span, polyphony, mapping, rule);
  const isStrum = rule === "strum";

  for (let v = 0; v < voiceCount; v++) {
    const note = chosenPitches[v];
    const vSlot = v % MAX_VOICES;
    const vVel = Math.min(127, Math.max(30, vel - v * 4));
    const delay = isStrum ? v * 24 : 0;
    const cidx = chosenCellIndices[v];
    const cxCell = cidx % S;
    const cyCell = Math.floor(cidx / S);
    const col = VOICE_COLORS[v % VOICE_COLORS.length];

    if (delay > 0) {
      setTimeout(() => {
        playSandpileVoice(vSlot, note, vVel, Math.round(gateLen * 0.85));
        spawnRipple(cxCell, cyCell, 16 + v * 6, col);
      }, delay);
    } else {
      playSandpileVoice(vSlot, note, vVel, gateLen);
      spawnRipple(cxCell, cyCell, 16 + v * 6, col);
    }
  }

  // MIDI CC #74 Brightness Modulation
  dispatchTimbreCc(toppleCount / 40, {
    dest: state.sandpileCcDest ?? 74,
    depth: state.sandpileCcDepth ?? 80,
    floorFactor: 0
  });
}

// ---- Autonomous Free Physics Loop ----
function sandpileLoop(timestamp) {
  if (!lastFrameTime) lastFrameTime = timestamp;
  const dt = Math.min(0.1, (timestamp - lastFrameTime) / 1000);
  lastFrameTime = timestamp;

  const S = Math.min(MAX_GRID_SIZE, Math.max(15, state.sandpileGridSize ?? 33));
  const speedMult = Math.max(0.1, Number(state.modelSpeed ?? 1.0));
  const rate = Math.max(0.5, state.sandpileDropRate ?? 10) * speedMult;
  const amount = Math.min(16, Math.max(1, state.sandpileDropAmount ?? 1));
  const pattern = state.sandpileDropPattern || "center";

  // Feed sand grains when playing
  if (isSandpilePlaying) {
    dropAccumulator += dt * rate;
    while (dropAccumulator >= 1.0) {
      dropAccumulator -= 1.0;
      const [dx, dy] = getDropCoordinate(pattern, S);
      dropGrains(dx, dy, amount);
    }
  }

  // Relax the sandpile via toppling
  runAvalancheCascade(350, true);

  // Decay flash highlights
  for (let i = 0; i < S * S; i++) {
    if (flashLife[i] > 0.02) flashLife[i] *= 0.88;
    else flashLife[i] = 0;
  }

  // Update ripple wave radii
  for (let i = 0; i < MAX_RIPPLES; i++) {
    if (rippleAlpha[i] > 0.05) {
      rippleRadius[i] += dt * 75 * speedMult;
      rippleAlpha[i] -= dt * 2.2 * speedMult;
    } else {
      rippleAlpha[i] = 0;
    }
  }

  if (comAlpha > 0.02) comAlpha -= dt * 1.5;

  renderSandpileCanvas();
  updateReadoutMetrics();

  animFrameId = requestAnimationFrame(sandpileLoop);
}

export function isSandpileRunning() {
  return isSandpilePlaying;
}

export function startSandpile() {
  if (isSandpilePlaying) return;
  isSandpilePlaying = true;
  audio.unlock();
  dropAccumulator = 0;
  lastAvalancheSize = 0;
  updatePlayBtnUI();
  status("Abelian Sandpile: Playing · Self-Organized Critical Avalanches", "ok");
}

export function stopSandpile() {
  isSandpilePlaying = false;
  releaseAllVoices();
  updatePlayBtnUI();
  status("stopped");
}

export function toggleSandpileRunning() {
  if (isSandpilePlaying) {
    stopSandpile();
    return false;
  } else {
    startSandpile();
    return true;
  }
}

function updatePlayBtnUI() {
  const headerBtn = document.getElementById("audition");
  if (headerBtn) {
    headerBtn.textContent = isSandpilePlaying ? "■ Stop" : "▶ Play";
    if (isSandpilePlaying) {
      headerBtn.classList.add("playing");
    } else {
      headerBtn.classList.remove("playing");
    }
  }
}

function updateReadoutMetrics() {
  if (!statReadoutEl) return;
  const S = Math.min(MAX_GRID_SIZE, Math.max(15, state.sandpileGridSize ?? 33));
  const avg = (totalGrains / (S * S)).toFixed(2);
  statReadoutEl.textContent = `Lattice: ${S}×${S} · Grains: ${totalGrains} (avg ${avg}) · Last Avalanche: ${lastAvalancheSize} · Peak: ${peakAvalancheSize} · Voices: ${getActiveVoiceCount()}/8`;
}

// ---- Canvas Rendering (Flat Workbench Aesthetic, Zero Gradients) ----
function renderSandpileCanvas() {
  if (!sandpileCanvas) return;
  const ctx = sandpileCanvas.getContext("2d");
  const w = sandpileCanvas.width;
  const h = sandpileCanvas.height;

  const style = getComputedStyle(document.documentElement);
  const colBg = style.getPropertyValue("--bg").trim() || "#111215";
  const colPanel = style.getPropertyValue("--panel").trim() || "#18191f";
  const colPanel2 = style.getPropertyValue("--panel2").trim() || "#22252e";
  const colLine = style.getPropertyValue("--line").trim() || "#333846";
  const colLineFocus = style.getPropertyValue("--line-focus").trim() || "#4b5264";
  const colFg = style.getPropertyValue("--fg").trim() || "#f3f4f6";
  const colDim = style.getPropertyValue("--dim").trim() || "#9ca3af";
  const colAccent = style.getPropertyValue("--accent").trim() || "#3b82f6";
  const colAccent2 = style.getPropertyValue("--accent2").trim() || "#60a5fa";
  const colOk = style.getPropertyValue("--ok").trim() || "#22c55e";

  ctx.fillStyle = colPanel2;
  ctx.fillRect(0, 0, w, h);

  const S = Math.min(MAX_GRID_SIZE, Math.max(15, state.sandpileGridSize ?? 33));
  const cellW = w / S;
  const cellH = h / S;

  // Render individual lattice cells
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const idx = y * S + x;
      const z = grid[idx];
      const flash = flashLife[idx];

      // Flat solid fill according to grain capacity (strictly no gradients)
      if (flash > 0.1) {
        ctx.fillStyle = colOk;
        ctx.globalAlpha = 0.5 + flash * 0.5;
      } else if (z === 0) {
        ctx.fillStyle = colPanel;
        ctx.globalAlpha = 1.0;
      } else if (z === 1) {
        ctx.fillStyle = colLine;
        ctx.globalAlpha = 0.65;
      } else if (z === 2) {
        ctx.fillStyle = colAccent;
        ctx.globalAlpha = 0.45;
      } else if (z === 3) {
        // Critical threshold: bright accent2
        ctx.fillStyle = colAccent2;
        ctx.globalAlpha = 0.95;
      } else {
        // Active topple >= 4: bright white highlight
        ctx.fillStyle = "#ffffff";
        ctx.globalAlpha = 1.0;
      }

      ctx.fillRect(x * cellW, y * cellH, cellW, cellH);

      // Subtle cell outline
      if (cellW >= 6) {
        ctx.strokeStyle = colLine;
        ctx.lineWidth = 0.5;
        ctx.strokeRect(x * cellW, y * cellH, cellW, cellH);
      }
    }
  }
  ctx.globalAlpha = 1.0;

  // Center crosshair / emitter indicator
  const cx = Math.floor(S / 2) * cellW + cellW / 2;
  const cy = Math.floor(S / 2) * cellH + cellH / 2;

  ctx.strokeStyle = colLineFocus;
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 3]);
  ctx.beginPath();
  ctx.moveTo(cx, 0);
  ctx.lineTo(cx, h);
  ctx.moveTo(0, cy);
  ctx.lineTo(w, cy);
  ctx.stroke();
  ctx.setLineDash([]);

  // Deposition node target marker
  const pattern = state.sandpileDropPattern || "center";
  const [dx, dy] = getDropCoordinate(pattern, S);
  const px = dx * cellW + cellW / 2;
  const py = dy * cellH + cellH / 2;

  ctx.strokeStyle = colAccent;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(px, py, Math.max(4, cellW), 0, Math.PI * 2);
  ctx.stroke();

  // Expanding avalanche ripple rings
  for (let i = 0; i < MAX_RIPPLES; i++) {
    if (rippleAlpha[i] > 0.05) {
      const rx = rippleX[i] * cellW + cellW / 2;
      const ry = rippleY[i] * cellH + cellH / 2;
      ctx.strokeStyle = rippleColor[i];
      ctx.globalAlpha = rippleAlpha[i];
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(rx, ry, rippleRadius[i], 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1.0;

  // Center of mass indicator
  if (comAlpha > 0.05) {
    const comScreenX = currentComX * cellW + cellW / 2;
    const comScreenY = currentComY * cellH + cellH / 2;
    ctx.strokeStyle = colOk;
    ctx.lineWidth = 2;
    ctx.globalAlpha = comAlpha;

    const crossSize = 8;
    ctx.beginPath();
    ctx.moveTo(comScreenX - crossSize, comScreenY);
    ctx.lineTo(comScreenX + crossSize, comScreenY);
    ctx.moveTo(comScreenX, comScreenY - crossSize);
    ctx.lineTo(comScreenX, comScreenY + crossSize);
    ctx.stroke();
    ctx.globalAlpha = 1.0;
  }
}

// ---- Step-based Generator Contract (Sync Mode) ----
export function generateSandpileBank(s = state) {
  const seqLen = s.length || 16;
  const rateIdx = typeof s.rate === "number" ? s.rate : RATE_NAMES.indexOf(s.rate);
  const safeRate = rateIdx >= 0 ? rateIdx : 6;
  const intervals = getActiveScaleIntervals();
  const root = getRootMidi();
  const span = Math.min(4, Math.max(1, s.sandpileSpan ?? s.pitchSpan ?? 2));
  const S = Math.min(MAX_GRID_SIZE, Math.max(15, s.sandpileGridSize ?? 33));

  const bank = [];

  for (let slot = 0; slot < 4; slot++) {
    const steps = [];
    const amount = s.sandpileDropAmount ?? 1;

    for (let i = 0; i < seqLen; i++) {
      // Deterministically drop grains per step
      const cx = Math.floor(S / 2);
      const cy = Math.floor(S / 2);
      const angle = (i / seqLen) * Math.PI * 2 + slot * 1.5;
      const r = Math.round(Math.sin(angle * 2) * (S / 4));
      const dropX = Math.max(1, Math.min(S - 2, cx + r));
      const dropY = Math.max(1, Math.min(S - 2, cy + Math.round(Math.cos(angle) * (S / 4))));

      dropGrains(dropX, dropY, amount);
      const topples = runAvalancheCascade(150, false);

      const mapping = s.sandpilePitchMapping || "x-axis";
      const rule = s.sandpileCellRule || "extrema";
      const polyphony = Math.min(MAX_VOICES, Math.max(1, s.sandpilePolyphony ?? 3));
      const voiceCount = extractSandpilePitches(toppleSiteCount, S, root, intervals, span, polyphony, mapping, rule);

      const stepNotes = [];
      for (let v = 0; v < voiceCount; v++) {
        stepNotes.push(chosenPitches[v]);
      }
      const vel = Math.min(127, Math.max(40, 70 + Math.round(Math.log2(topples + 1) * 10)));

      steps.push({
        notes: stepNotes,
        velocity: vel,
        gate: s.sandpileGateLen ? Math.min(100, Math.max(10, Math.round(s.sandpileGateLen / 3))) : 50,
        rate: safeRate
      });
    }

    bank.push({
      length: seqLen,
      steps,
      rate: safeRate
    });
  }

  return bank;
}

export function syncSandpileFromRegen() {
  const b = generateSandpileBank(state);
  setBank(b);
  syncRhythmGrid();
  renderSandpileCanvas();
}

export function randomizeSandpile() {
  const presets = ["empty", "critical", "pyramid", "checker", "apollonian"];
  const chosenPreset = presets[Math.floor(Math.random() * presets.length)];
  state.sandpilePreset = chosenPreset;
  state.sandpileDropRate = Math.round(4 + Math.random() * 20);
  state.sandpileDropAmount = Math.round(1 + Math.random() * 3);
  state.sandpilePolyphony = Math.floor(1 + Math.random() * 4);
  state.sandpileBoundary = Math.random() > 0.3 ? "open" : "closed";
  const patterns = ["center", "corners", "cross", "random", "spiral"];
  state.sandpileDropPattern = patterns[Math.floor(Math.random() * patterns.length)];
  const mappings = ["x-axis", "y-axis", "radial", "height", "diagonal"];
  state.sandpilePitchMapping = mappings[Math.floor(Math.random() * mappings.length)];
  const rules = ["extrema", "centroid", "peak-energy", "strum"];
  state.sandpileCellRule = rules[Math.floor(Math.random() * rules.length)];

  initSandpileGrid(chosenPreset);
  syncControlsFromState();
  renderSandpileCanvas();
  status(`Sandpile random layout: ${chosenPreset}`, "ok");
}

function syncControlsFromState() {
  if (refs.sandpileGridSize?.setValue) refs.sandpileGridSize.setValue(state.sandpileGridSize, false);
  if (refs.sandpileDropRate?.setValue) refs.sandpileDropRate.setValue(state.sandpileDropRate, false);
  if (refs.sandpileDropAmount?.setValue) refs.sandpileDropAmount.setValue(state.sandpileDropAmount, false);
  if (refs.sandpilePolyphony?.setValue) refs.sandpilePolyphony.setValue(state.sandpilePolyphony ?? 3, false);
  if (refs.sandpileSpan?.setValue) refs.sandpileSpan.setValue(String(state.sandpileSpan ?? 2), false);
  if (refs.sandpileGateLen?.setValue) refs.sandpileGateLen.setValue(state.sandpileGateLen, false);
  if (refs.sandpileVelocity?.setValue) refs.sandpileVelocity.setValue(state.sandpileVelocity, false);
  if (refs.sandpileCcDepth?.setValue) refs.sandpileCcDepth.setValue(state.sandpileCcDepth, false);
  if (refs.sandpileDropPattern?.setValue) refs.sandpileDropPattern.setValue(state.sandpileDropPattern || "center", false);
  if (refs.sandpileBoundary?.setValue) refs.sandpileBoundary.setValue(state.sandpileBoundary || "open", false);
  if (refs.sandpilePitchMapping?.setValue) refs.sandpilePitchMapping.setValue(state.sandpilePitchMapping || "x-axis", false);
  if (refs.sandpileCellRule?.setValue) refs.sandpileCellRule.setValue(state.sandpileCellRule || "extrema", false);
  if (presetSelect) presetSelect.value = state.sandpilePreset || "empty";
}

// ---- DOM Workbench Interface Construction ----
export function initSandpile() {
  sandpileContainer = document.getElementById("model-sandpile");
  if (!sandpileContainer) return;
  sandpileContainer.innerHTML = "";

  const layout = document.createElement("div");
  layout.className = "layout sandpile-layout";
  layout.style.display = "flex";
  layout.style.gap = "12px";
  layout.style.padding = "10px";

  // --- Left Column: Controls Module ---
  const module = document.createElement("div");
  module.className = "module sandpile-module";
  module.style.flex = "0 0 340px";
  module.style.display = "flex";
  module.style.flexDirection = "column";
  module.style.gap = "8px";

  // Card 1: Header & Quick Actions
  const headerCard = document.createElement("div");
  headerCard.className = "card sandpile-header-card";
  headerCard.style.padding = "8px 12px";

  const topRow = document.createElement("div");
  topRow.style.display = "flex";
  topRow.style.justifyContent = "space-between";
  topRow.style.alignItems = "center";
  topRow.style.marginBottom = "6px";

  const titleGroup = document.createElement("div");
  titleGroup.innerHTML = `
    <div style="font-size:12px; font-weight:700; color:var(--fg); letter-spacing:1px; text-transform:uppercase;">Abelian Sandpile (SOC)</div>
    <div style="font-size:10px; color:var(--dim);">Self-Organized Criticality · Avalanches · Lattice Cascades</div>
  `;

  const actionsGroup = document.createElement("div");
  actionsGroup.style.display = "flex";
  actionsGroup.style.gap = "4px";

  const btnDrop = document.createElement("button");
  btnDrop.className = "btn-action";
  btnDrop.style.fontSize = "10px";
  btnDrop.style.padding = "3px 8px";
  btnDrop.textContent = "Drop 1";
  btnDrop.title = "Drop a single sand grain onto the lattice";
  btnDrop.addEventListener("click", () => {
    audio.unlock();
    const S = Math.min(MAX_GRID_SIZE, Math.max(15, state.sandpileGridSize ?? 33));
    const [dx, dy] = getDropCoordinate(state.sandpileDropPattern || "center", S);
    dropGrains(dx, dy, 1);
    const toppled = runAvalancheCascade(250, true);
    if (toppled === 0) {
      playDropletPing(dx, dy, S);
    }
    renderSandpileCanvas();
  });

  const btnBurst = document.createElement("button");
  btnBurst.className = "btn-action";
  btnBurst.style.fontSize = "10px";
  btnBurst.style.padding = "3px 8px";
  btnBurst.textContent = "Burst 50";
  btnBurst.title = "Drop a massive cluster of 50 grains at center to trigger an avalanche";
  btnBurst.addEventListener("click", () => {
    audio.unlock();
    const S = Math.min(MAX_GRID_SIZE, Math.max(15, state.sandpileGridSize ?? 33));
    const cx = Math.floor(S / 2);
    const cy = Math.floor(S / 2);
    dropGrains(cx, cy, 50);
    runAvalancheCascade(350, true);
    renderSandpileCanvas();
    status("Sandpile: 50-grain burst triggered", "ok");
  });

  const btnClear = document.createElement("button");
  btnClear.className = "btn-action";
  btnClear.style.fontSize = "10px";
  btnClear.style.padding = "3px 8px";
  btnClear.textContent = "Clear";
  btnClear.title = "Reset lattice to empty";
  btnClear.addEventListener("click", () => {
    initSandpileGrid("empty");
    renderSandpileCanvas();
    status("Sandpile lattice cleared");
  });

  actionsGroup.append(btnDrop, btnBurst, btnClear);
  topRow.append(titleGroup, actionsGroup);

  // Preset Selector Dropdown
  const presetRow = document.createElement("div");
  presetRow.style.display = "flex";
  presetRow.style.alignItems = "center";
  presetRow.style.gap = "6px";
  presetRow.style.marginTop = "6px";

  const presetLabel = document.createElement("span");
  presetLabel.style.fontSize = "10px";
  presetLabel.style.fontWeight = "600";
  presetLabel.style.color = "var(--dim)";
  presetLabel.textContent = "PRESET";

  presetSelect = document.createElement("select");
  presetSelect.className = "lsystem-select";
  presetSelect.style.fontSize = "10px";
  presetSelect.style.flex = "1";
  for (const pr of SANDPILE_PRESETS) {
    const opt = document.createElement("option");
    opt.value = pr.id;
    opt.textContent = `${pr.name} — ${pr.desc}`;
    presetSelect.appendChild(opt);
  }
  presetSelect.value = state.sandpilePreset || "empty";
  presetSelect.addEventListener("change", (e) => {
    const pid = e.target.value;
    state.sandpilePreset = pid;
    initSandpileGrid(pid);
    renderSandpileCanvas();
    status(`Sandpile preset: ${pid}`, "ok");
  });

  presetRow.append(presetLabel, presetSelect);
  headerCard.append(topRow, presetRow);

  // Card 2: Parameters Grid
  const paramCard = document.createElement("div");
  paramCard.className = "card sandpile-param-card";
  paramCard.style.padding = "8px 12px";

  const paramGrid = document.createElement("div");
  paramGrid.className = "sandpile-param-grid";
  paramGrid.style.display = "grid";
  paramGrid.style.gridTemplateColumns = "repeat(4, 1fr)";
  paramGrid.style.gap = "6px";

  const kSize = knob({
    label: "SIZE",
    min: 17, max: 49, step: 4,
    value: state.sandpileGridSize ?? 33,
    unit: "",
    title: "Lattice width and height (odd dimensions)",
    onChange: (v) => {
      state.sandpileGridSize = Math.round(v);
      initSandpileGrid(state.sandpilePreset);
      renderSandpileCanvas();
    }
  });
  R("sandpileGridSize", kSize);

  const kRate = knob({
    label: "RATE",
    min: 1, max: 35, step: 1,
    value: state.sandpileDropRate ?? 10,
    unit: "Hz",
    title: "Continuous sand deposition rate (grains per second)",
    onChange: (v) => {
      state.sandpileDropRate = v;
    }
  });
  R("sandpileDropRate", kRate);

  const kAmount = knob({
    label: "GRAINS",
    min: 1, max: 12, step: 1,
    value: state.sandpileDropAmount ?? 1,
    unit: "",
    title: "Number of grains deposited per drop tick",
    onChange: (v) => {
      state.sandpileDropAmount = Math.round(v);
    }
  });
  R("sandpileDropAmount", kAmount);

  const kSpan = knob({
    label: "SPAN",
    min: 1, max: 4, step: 1,
    value: state.sandpileSpan ?? 2,
    unit: "oct",
    title: "Octave range mapped across the lattice",
    onChange: (v) => {
      state.sandpileSpan = Math.round(v);
      state.pitchSpan = state.sandpileSpan;
    }
  });
  R("sandpileSpan", kSpan);

  const kGate = knob({
    label: "GATE",
    min: 40, max: 400, step: 10,
    value: state.sandpileGateLen ?? 180,
    unit: "ms",
    title: "Note trigger gate duration",
    onChange: (v) => {
      state.sandpileGateLen = v;
    }
  });
  R("sandpileGateLen", kGate);

  const kVel = knob({
    label: "VELOCITY",
    min: 30, max: 127, step: 1,
    value: state.sandpileVelocity ?? 90,
    unit: "",
    title: "Base MIDI velocity for avalanche triggers",
    onChange: (v) => {
      state.sandpileVelocity = Math.round(v);
    }
  });
  R("sandpileVelocity", kVel);

  const kCc = knob({
    label: "FM CC74",
    min: 0, max: 127, step: 1,
    value: state.sandpileCcDepth ?? 80,
    unit: "",
    title: "MIDI CC #74 Brightness modulation depth driven by avalanche power",
    onChange: (v) => {
      state.sandpileCcDepth = v;
    }
  });
  R("sandpileCcDepth", kCc);

  paramGrid.append(kSize, kRate, kAmount, kSpan, kGate, kVel, kCc);

  // Dropdown Row: Pattern, Boundary, Pitch Mapping
  const dropdownRow = document.createElement("div");
  dropdownRow.style.display = "grid";
  dropdownRow.style.gridTemplateColumns = "repeat(3, 1fr)";
  dropdownRow.style.gap = "6px";
  dropdownRow.style.marginTop = "8px";

  const pPattern = R("sandpileDropPattern", dropdown({
    label: "PATTERN",
    options: [
      { v: "center", t: "Center Sink" },
      { v: "corners", t: "Four Corners" },
      { v: "cross", t: "Cross Lattice" },
      { v: "spiral", t: "Orbital Spiral" },
      { v: "random", t: "Rain / Random" }
    ],
    value: state.sandpileDropPattern || "center",
    onInput: (v) => {
      state.sandpileDropPattern = v;
      renderSandpileCanvas();
    }
  }));

  const pBoundary = R("sandpileBoundary", dropdown({
    label: "BOUND",
    options: [
      { v: "open", t: "Open Sink (SOC)" },
      { v: "closed", t: "Reflective Wall" },
      { v: "wrap", t: "Toroidal Wrap" }
    ],
    value: state.sandpileBoundary || "open",
    onInput: (v) => {
      state.sandpileBoundary = v;
    }
  }));

  const pMapping = R("sandpilePitchMapping", dropdown({
    label: "MAPPING",
    options: [
      { v: "x-axis", t: "X-Axis (L → R)" },
      { v: "y-axis", t: "Y-Axis (B → T)" },
      { v: "radial", t: "Radial (Center Out)" },
      { v: "height", t: "Grain Density" },
      { v: "diagonal", t: "Diagonal Wave" }
    ],
    value: state.sandpilePitchMapping || "x-axis",
    onInput: (v) => {
      state.sandpilePitchMapping = v;
    }
  }));

  dropdownRow.append(pPattern, pBoundary, pMapping);
  paramCard.append(paramGrid, dropdownRow);

  module.append(headerCard, paramCard);

  // --- Right Column: Interactive Sandpile Canvas Matrix ---
  const display = document.createElement("div");
  display.className = "display sandpile-display";
  display.style.flex = "1";
  display.style.display = "flex";
  display.style.flexDirection = "column";

  const canvasCard = document.createElement("div");
  canvasCard.className = "card sandpile-canvas-card";
  canvasCard.style.padding = "8px 12px";
  canvasCard.style.display = "flex";
  canvasCard.style.flexDirection = "column";
  canvasCard.style.flex = "1";

  const canvasHeader = document.createElement("div");
  canvasHeader.style.display = "flex";
  canvasHeader.style.justifyContent = "space-between";
  canvasHeader.style.alignItems = "center";
  canvasHeader.style.marginBottom = "6px";
  canvasHeader.innerHTML = `
    <span style="font-size:10px; font-weight:700; color:var(--fg); letter-spacing:1px; text-transform:uppercase;">Sandpile Critical Lattice Matrix</span>
    <span style="font-size:9px; color:var(--dim);">Click/Drag to deposit sand · Shift+Click for burst cascade</span>
  `;

  sandpileCanvas = document.createElement("canvas");
  sandpileCanvas.width = 512;
  sandpileCanvas.height = 512;
  sandpileCanvas.style.width = "100%";
  sandpileCanvas.style.maxWidth = "512px";
  sandpileCanvas.style.aspectRatio = "1 / 1";
  sandpileCanvas.style.background = "var(--panel2)";
  sandpileCanvas.style.border = "1px solid var(--line)";
  sandpileCanvas.style.cursor = "crosshair";

  // Canvas Direct Manipulation: Click/Drag to drop sand
  let isPointerDown = false;

  function handleCanvasPointer(e) {
    audio.unlock();
    const rect = sandpileCanvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const S = Math.min(MAX_GRID_SIZE, Math.max(15, state.sandpileGridSize ?? 33));
    const cellX = Math.floor((mx / rect.width) * S);
    const cellY = Math.floor((my / rect.height) * S);

    if (cellX >= 0 && cellX < S && cellY >= 0 && cellY < S) {
      const dropQty = e.shiftKey ? 30 : Math.max(1, state.sandpileDropAmount ?? 1);
      dropGrains(cellX, cellY, dropQty);
      const toppled = runAvalancheCascade(250, true);
      if (toppled === 0) {
        playDropletPing(cellX, cellY, S);
      }
      renderSandpileCanvas();
    }
  }

  sandpileCanvas.addEventListener("pointerdown", (e) => {
    isPointerDown = true;
    sandpileCanvas.setPointerCapture(e.pointerId);
    handleCanvasPointer(e);
  });

  sandpileCanvas.addEventListener("pointermove", (e) => {
    if (isPointerDown) {
      handleCanvasPointer(e);
    }
  });

  sandpileCanvas.addEventListener("pointerup", (e) => {
    isPointerDown = false;
  });

  sandpileCanvas.addEventListener("pointercancel", (e) => {
    isPointerDown = false;
  });

  // Footer status bar for physical metrics
  statReadoutEl = document.createElement("div");
  statReadoutEl.style.fontSize = "9px";
  statReadoutEl.style.color = "var(--dim)";
  statReadoutEl.style.marginTop = "6px";
  statReadoutEl.style.fontFamily = "monospace";
  statReadoutEl.textContent = "Lattice: 33×33 · Grains: 0 · Last Avalanche: 0 · Peak: 0 · Voices: 0/8";

  canvasCard.append(canvasHeader, sandpileCanvas, statReadoutEl);
  display.appendChild(canvasCard);

  layout.append(module, display);
  sandpileContainer.appendChild(layout);

  initSandpileGrid(state.sandpilePreset || "empty");
  syncControlsFromState();
}

// ---- Model Activation Lifecycle ----
export function activateSandpileModel() {
  setModelGenerator(generateSandpileBank);
  setModelRandomizer(randomizeSandpile);
  setModelStepHandler(null);
  setModelTransportHandler({
    toggle: toggleSandpileRunning,
    stop: stopSandpile,
    start: startSandpile,
    isRunning: isSandpileRunning
  });

  doGenerate(false);
  renderSandpileCanvas();

  if (!animFrameId) {
    lastFrameTime = performance.now();
    animFrameId = requestAnimationFrame(sandpileLoop);
  }

  updatePlayBtnUI();
  status("Abelian Sandpile (SOC): Ready (Press Play or Spacebar to start avalanches)", "ok");
}

export function deactivateSandpileModel() {
  stopSandpile();
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
  id: "sandpile",
  version: 1,
  migrations: {},
  capture: () => {
    const S = Math.min(MAX_GRID_SIZE, Math.max(15, state.sandpileGridSize ?? 33));
    return {
      size: S,
      preset: state.sandpilePreset,
      dropRate: state.sandpileDropRate,
      dropAmount: state.sandpileDropAmount,
      pattern: state.sandpileDropPattern,
      boundary: state.sandpileBoundary,
      mapping: state.sandpilePitchMapping,
      rule: state.sandpileCellRule,
      polyphony: state.sandpilePolyphony,
      span: state.sandpileSpan,
      gateLen: state.sandpileGateLen,
      velocity: state.sandpileVelocity,
      totalGrains
    };
  },
  restore: (h) => {
    if (!h) return;
    if (h.size) state.sandpileGridSize = h.size;
    if (h.preset) state.sandpilePreset = h.preset;
    if (h.dropRate) state.sandpileDropRate = h.dropRate;
    if (h.dropAmount) state.sandpileDropAmount = h.dropAmount;
    if (h.pattern) state.sandpileDropPattern = h.pattern;
    if (h.boundary) state.sandpileBoundary = h.boundary;
    if (h.mapping) state.sandpilePitchMapping = h.mapping;
    if (h.rule) state.sandpileCellRule = h.rule;
    if (h.polyphony) state.sandpilePolyphony = h.polyphony;
    if (h.span) state.sandpileSpan = h.span;
    if (h.gateLen) state.sandpileGateLen = h.gateLen;
    if (h.velocity) state.sandpileVelocity = h.velocity;

    initSandpileGrid(state.sandpilePreset || "empty");
    syncControlsFromState();
    renderSandpileCanvas();
  }
});
