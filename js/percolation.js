// percolation.js — Percolation Cluster & Fluid Porosity Phase Transition for FM-1 Pulses.
// Physical statistical mechanics simulator based on 2D lattice site percolation & Disjoint Set Union (DSU).
//
// Generative Architecture:
// 1. 2D site percolation lattice (sites randomly open with probability p; critical phase threshold pc ≈ 0.5927).
// 2. Disjoint Set Union (Union-Find) with path compression & union-by-size for connected cluster analysis (zero GC).
// 3. Spanning cluster detection: identifies macroscopic conductive channels connecting opposing lattice boundaries.
// 4. Conduction wavefront scanner: voltage pulse or fluid trickles through porous channels triggering polyphony.
// 5. Strict <= 8-voice polyphony ceiling with FIFO note-stealing ring buffer for M-VAVE FM-1 hardware.
// 6. Direct manipulation: interactive canvas toggling porous cells, shift-click conduction sparks, and real-time DSU recomputation.
// 7. Continuous FM-1 CC #74 Brightness modulation reflecting instantaneous cluster conductivity.
// 8. Dual Sync/Free modes: 64-step transport-locked bank sequence or continuous real-time conduction waves.

import {
  state, refs, R, setState, scheduleRegen, doGenerate,
  getBank, setBank, getSelected, setSelected, status, onRegen,
  setModelGenerator, setModelRandomizer, RATE_NAMES
} from "./state.js";
import { knob, dropdown, actionBtn } from "./controls.js";
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
const MAX_W = 48;
const MAX_H = 32;
const MAX_CELLS = MAX_W * MAX_H;
const MAX_VOICES = 8;
const CRITICAL_P = 0.592746;

// Lattice & Cluster Buffers
const grid = new Uint8Array(MAX_CELLS);
const sparkLife = new Float32Array(MAX_CELLS);
const clusterTouched = new Uint8Array(MAX_CELLS);
const cellFatigue = new Float32Array(MAX_CELLS); // Refractory fatigue (0.0 to 1.0)
const cellAge = new Uint16Array(MAX_CELLS);     // Inactive cycles for sedimentation

// DSU Buffers
const parent = new Int32Array(MAX_CELLS);
const clusterSize = new Int32Array(MAX_CELLS);
const touchTop = new Uint8Array(MAX_CELLS);
const touchBottom = new Uint8Array(MAX_CELLS);
const touchLeft = new Uint8Array(MAX_CELLS);
const touchRight = new Uint8Array(MAX_CELLS);
const isSpanning = new Uint8Array(MAX_CELLS);

// Cluster polyphonic voice candidates (zero GC)
const activeCandidates = new Int32Array(MAX_CELLS);
const candidateRoots = new Int32Array(MAX_CELLS);
const candidateSizes = new Int32Array(MAX_CELLS);
const candidatePitches = new Int32Array(MAX_CELLS);
const chosenVoices = new Int32Array(MAX_VOICES);

// 8-Voice FIFO voice slot index
let voiceCounter = 0;

// Simulation & Transport State
let isPercolationPlaying = false;
let animFrameId = null;
let lastFrameTime = 0;
let scanAccumulator = 0;
let scanPhase = 0; // Current scan index (row, col, or radius)
let fluidFrontier = new Int32Array(MAX_CELLS);
let fluidFrontierCount = 0;
let nextFrontier = new Int32Array(MAX_CELLS);

// Metrics
let totalOpenCells = 0;
let totalClusters = 0;
let hasSpanningCluster = false;
let spanningClusterSize = 0;
let currentConduction = 0;

// DOM & Canvas elements
let percolationContainer = null;
let percolationCanvas = null;
let statReadoutEl = null;

// Presets
export const PERCOLATION_PRESETS = [
  {
    id: "critical",
    name: "Critical Phase (p ≈ 0.593)",
    desc: "Self-similar fractal branching at the percolation critical threshold (pc ≈ 0.5927)",
    p: 0.593,
    w: 32, h: 20,
    scan: "top-down",
    map: "x-scale",
    conn: "4-way"
  },
  {
    id: "subcritical",
    name: "Subcritical Droplets (p = 0.42)",
    desc: "Sparse isolated cluster islands producing crystalline staccato droplets",
    p: 0.42,
    w: 32, h: 20,
    scan: "fluid",
    map: "cluster-size",
    conn: "4-way"
  },
  {
    id: "supercritical",
    name: "Supercritical Torrent (p = 0.75)",
    desc: "Dense permeable sponge dominated by an infinite spanning choral wash",
    p: 0.75,
    w: 32, h: 20,
    scan: "top-down",
    map: "harmonic",
    conn: "4-way"
  },
  {
    id: "channels",
    name: "Vertical Aquifers",
    desc: "Anisotropic porous channels with vertical groundwater flow",
    p: 0.55,
    w: 32, h: 20,
    scan: "fluid",
    map: "centroid",
    conn: "4-way"
  },
  {
    id: "lightning",
    name: "Conduction Lightning",
    desc: "Left-to-right electrical discharge across conductive bridges",
    p: 0.61,
    w: 32, h: 20,
    scan: "left-right",
    map: "x-scale",
    conn: "8-way"
  },
  {
    id: "radial",
    name: "Radial Percolation Ripple",
    desc: "Fluid injected into center expanding outward along concentric porous rings",
    p: 0.58,
    w: 32, h: 20,
    scan: "radial",
    map: "cluster-size",
    conn: "4-way"
  }
];

// ---- Disjoint Set Union (DSU) Engine with Path Compression ----
function dsuFind(i) {
  let root = i;
  while (root !== parent[root]) root = parent[root];
  let curr = i;
  while (curr !== root) {
    const next = parent[curr];
    parent[curr] = root;
    curr = next;
  }
  return root;
}

function dsuUnion(i, j) {
  const rootI = dsuFind(i);
  const rootJ = dsuFind(j);
  if (rootI === rootJ) return rootI;

  let newRoot, oldRoot;
  if (clusterSize[rootI] < clusterSize[rootJ]) {
    parent[rootI] = rootJ;
    clusterSize[rootJ] += clusterSize[rootI];
    newRoot = rootJ;
    oldRoot = rootI;
  } else {
    parent[rootJ] = rootI;
    clusterSize[rootI] += clusterSize[rootJ];
    newRoot = rootI;
    oldRoot = rootJ;
  }

  // Merge boundary touch flags
  if (touchTop[oldRoot]) touchTop[newRoot] = 1;
  if (touchBottom[oldRoot]) touchBottom[newRoot] = 1;
  if (touchLeft[oldRoot]) touchLeft[newRoot] = 1;
  if (touchRight[oldRoot]) touchRight[newRoot] = 1;

  return newRoot;
}

// Recompute all clusters using DSU
export function recomputePercolationClusters() {
  const W = getGridW();
  const H = getGridH();
  const total = W * H;
  const is8Way = (state.percolationConn || "4-way") === "8-way";

  totalOpenCells = 0;
  totalClusters = 0;
  hasSpanningCluster = false;
  spanningClusterSize = 0;

  // Initialize DSU state
  for (let i = 0; i < total; i++) {
    parent[i] = i;
    clusterSize[i] = 1;
    isSpanning[i] = 0;
    const x = i % W;
    const y = Math.floor(i / W);
    touchTop[i] = y === 0 ? 1 : 0;
    touchBottom[i] = y === H - 1 ? 1 : 0;
    touchLeft[i] = x === 0 ? 1 : 0;
    touchRight[i] = x === W - 1 ? 1 : 0;
    if (grid[i]) totalOpenCells++;
  }

  // Union adjacent open cells
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const idx = y * W + x;
      if (!grid[idx]) continue;

      // 4-way cardinal neighbors
      if (x + 1 < W && grid[idx + 1]) dsuUnion(idx, idx + 1);
      if (y + 1 < H && grid[idx + W]) dsuUnion(idx, idx + W);

      // 8-way diagonal neighbors if enabled
      if (is8Way) {
        if (x + 1 < W && y + 1 < H && grid[idx + W + 1]) dsuUnion(idx, idx + W + 1);
        if (x - 1 >= 0 && y + 1 < H && grid[idx + W - 1]) dsuUnion(idx, idx + W - 1);
      }
    }
  }

  // Determine spanning cluster and count components
  for (let i = 0; i < total; i++) {
    if (!grid[i]) continue;
    if (parent[i] === i) {
      totalClusters++;
      // A cluster is spanning if it connects Top to Bottom or Left to Right
      const spansY = touchTop[i] && touchBottom[i];
      const spansX = touchLeft[i] && touchRight[i];
      if (spansY || spansX) {
        hasSpanningCluster = true;
        if (clusterSize[i] > spanningClusterSize) {
          spanningClusterSize = clusterSize[i];
        }
      }
    }
  }

  // Mark all cells belonging to a spanning cluster
  for (let i = 0; i < total; i++) {
    if (!grid[i]) continue;
    const root = dsuFind(i);
    const spans = (touchTop[root] && touchBottom[root]) || (touchLeft[root] && touchRight[root]);
    isSpanning[i] = spans ? 1 : 0;
  }

  currentConduction = totalOpenCells > 0 ? (spanningClusterSize / totalOpenCells) : 0;
}

// Reseed grid based on probability p
export function reseedPercolation(customPreset = null) {
  const W = getGridW();
  const H = getGridH();
  const total = W * H;
  const p = Math.min(0.95, Math.max(0.05, state.percolationProb ?? 0.593));

  if (customPreset === "empty") {
    grid.fill(0);
  } else if (customPreset === "channels") {
    // Generate anisotropic vertical channels with cross-struts
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const idx = y * W + x;
        const isColumn = (x % 3 === 0);
        const isCross = (y % 4 === 0 && Math.random() < 0.6);
        grid[idx] = (isColumn && Math.random() < 0.85) || isCross || (Math.random() < 0.25) ? 1 : 0;
      }
    }
  } else if (customPreset === "lightning") {
    // Left-to-right zigzag conductive spine plus ambient clusters
    grid.fill(0);
    let curY = Math.floor(H / 2);
    for (let x = 0; x < W; x++) {
      curY += Math.floor((Math.random() - 0.48) * 3);
      curY = Math.max(1, Math.min(H - 2, curY));
      grid[curY * W + x] = 1;
      if (Math.random() < 0.6) grid[(curY + 1) * W + x] = 1;
      if (Math.random() < 0.6) grid[(curY - 1) * W + x] = 1;
    }
    // Add ambient clusters
    for (let i = 0; i < total; i++) {
      if (Math.random() < 0.35) grid[i] = 1;
    }
  } else {
    for (let i = 0; i < total; i++) {
      grid[i] = Math.random() < p ? 1 : 0;
    }
  }

  sparkLife.fill(0);
  cellFatigue.fill(0);
  cellAge.fill(0);
  scanPhase = 0;
  initFluidFrontier();
  recomputePercolationClusters();
}

function initFluidFrontier() {
  const W = getGridW();
  fluidFrontierCount = 0;
  for (let x = 0; x < W; x++) {
    if (grid[x]) {
      fluidFrontier[fluidFrontierCount++] = x;
    }
  }
}

function getGridW() {
  const dim = state.percolationGridDim || "32x20";
  if (dim === "24x16") return 24;
  if (dim === "40x24") return 40;
  return 32;
}

function getGridH() {
  const dim = state.percolationGridDim || "32x20";
  if (dim === "24x16") return 16;
  if (dim === "40x24") return 24;
  return 20;
}

// ---- Voice Allocation & Audio Dispatch (Strict <= 8 Voices via js/poly.js) ----
function playPercolationVoice(voiceKey, note, vel, durMs) {
  playVoice(voiceKey, note, vel, durMs);
}

function releaseAllVoices() {
  releasePolyVoices();
}

// ---- Pitch Mapping Calculation ----
function mapCellToPitch(cellIdx, cRoot, cSize, W, H, intervals, rootMidi, span, mappingMode) {
  const x = cellIdx % W;
  const y = Math.floor(cellIdx / W);
  const numIntervals = intervals.length || 7;

  let deg = 0;
  let octShift = 0;

  if (mappingMode === "cluster-size") {
    // Small clusters = higher crystalline octaves; giant clusters = deep bass
    const logSize = Math.log2(Math.max(1, cSize));
    deg = Math.floor((x / W) * numIntervals) % numIntervals;
    octShift = Math.max(-1, Math.min(span, Math.round(3 - logSize * 0.7)));
  } else if (mappingMode === "centroid") {
    // Cluster centroid + vertical pitch mapping
    deg = Math.floor((x / W) * numIntervals) % numIntervals;
    octShift = Math.floor((1 - (y / H)) * span);
  } else if (mappingMode === "harmonic") {
    // Spanning / large clusters get roots & fifths; small clusters get upper extensions
    if (cSize >= 15) {
      deg = (x % 2 === 0) ? 0 : 4; // Root or 5th
      octShift = -1;
    } else {
      deg = Math.floor((x / W) * numIntervals) % numIntervals;
      octShift = Math.floor((1 - (y / H)) * span);
    }
  } else {
    // Default "x-scale": X determines scale degree, Y determines octave
    deg = Math.floor((x / W) * numIntervals) % numIntervals;
    octShift = Math.floor((1 - (y / H)) * span);
  }

  const rawMidi = rootMidi + octShift * 12 + (intervals[deg] || 0);
  return quantize(rawMidi, intervals, rootMidi);
}

// ---- Conduction Step Trigger ----
function triggerConductionStep() {
  const W = getGridW();
  const H = getGridH();
  const total = W * H;
  const scanMode = state.percolationScanMode || "top-down";
  const mapMode = state.percolationPitchMapping || "x-scale";
  const maxPoly = Math.min(MAX_VOICES, Math.max(1, state.polyphony ?? state.percolationPolyphony ?? 4));
  const span = Math.min(4, Math.max(1, state.percolationSpan ?? 2));
  const baseGate = Math.min(600, Math.max(60, state.percolationGateLen ?? 180));
  const intervals = getActiveScaleIntervals();
  const rootMidi = getRootMidi();
  const restAmount = Math.min(1.0, Math.max(0.0, (state.percolationRest ?? 40) / 100));
  const evoRate = Math.min(1.0, Math.max(0.0, (state.percolationEvo ?? 25) / 100));

  let candidateCount = 0;

  function candidatePassesFatigue(idx) {
    if (restAmount <= 0) return true;
    const f = cellFatigue[idx];
    if (f <= 0.05) return true;
    const fireChance = 1.0 - (f * restAmount * 0.85);
    return Math.random() < fireChance;
  }

  if (scanMode === "top-down") {
    const y = scanPhase % H;
    for (let x = 0; x < W; x++) {
      const idx = y * W + x;
      if (grid[idx] && candidatePassesFatigue(idx)) {
        activeCandidates[candidateCount++] = idx;
      }
    }
    scanPhase = (scanPhase + 1) % H;
  } else if (scanMode === "left-right") {
    const x = scanPhase % W;
    for (let y = 0; y < H; y++) {
      const idx = y * W + x;
      if (grid[idx] && candidatePassesFatigue(idx)) {
        activeCandidates[candidateCount++] = idx;
      }
    }
    scanPhase = (scanPhase + 1) % W;
  } else if (scanMode === "radial") {
    const cx = Math.floor(W / 2);
    const cy = Math.floor(H / 2);
    const maxR = Math.ceil(Math.hypot(cx, cy));
    const r = scanPhase % maxR;

    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const idx = y * W + x;
        if (!grid[idx]) continue;
        const dist = Math.hypot(x - cx, y - cy);
        if (Math.abs(dist - r) < 1.0 && candidatePassesFatigue(idx)) {
          activeCandidates[candidateCount++] = idx;
        }
      }
    }
    scanPhase = (scanPhase + 1) % maxR;
  } else if (scanMode === "fluid") {
    // Fluid trickle frontier
    if (fluidFrontierCount === 0) {
      initFluidFrontier();
    }
    let nextCount = 0;
    for (let i = 0; i < fluidFrontierCount; i++) {
      const idx = fluidFrontier[i];
      activeCandidates[candidateCount++] = idx;

      const x = idx % W;
      const y = Math.floor(idx / W);

      // Trickle downward or sideways
      if (y + 1 < H && grid[idx + W]) nextFrontier[nextCount++] = idx + W;
      if (x - 1 >= 0 && y + 1 < H && grid[idx + W - 1] && Math.random() < 0.4) nextFrontier[nextCount++] = idx + W - 1;
      if (x + 1 < W && y + 1 < H && grid[idx + W + 1] && Math.random() < 0.4) nextFrontier[nextCount++] = idx + W + 1;
    }

    // Copy to fluid frontier
    fluidFrontierCount = Math.min(MAX_CELLS, nextCount);
    for (let i = 0; i < fluidFrontierCount; i++) {
      fluidFrontier[i] = nextFrontier[i];
    }
  } else if (scanMode === "spanning") {
    // Resonant pulse across spanning cluster nodes
    const stride = Math.max(1, Math.floor(H / 8));
    const y = (scanPhase * stride) % H;
    for (let x = 0; x < W; x++) {
      const idx = y * W + x;
      if (grid[idx] && isSpanning[idx]) {
        activeCandidates[candidateCount++] = idx;
      }
    }
    scanPhase = (scanPhase + 1) % 8;
  }

  if (candidateCount === 0) return;

  // Collect candidate events across distinct clusters
  const candidateEvents = [];
  clusterTouched.fill(0);
  for (let i = 0; i < candidateCount; i++) {
    const cellIdx = activeCandidates[i];
    const cRoot = dsuFind(cellIdx);
    const cSize = clusterSize[cRoot];
    if (!clusterTouched[cRoot]) {
      clusterTouched[cRoot] = 1;
      const spans = isSpanning[cellIdx];
      const note = mapCellToPitch(cellIdx, cRoot, cSize, W, H, intervals, rootMidi, span, mapMode);
      const velBase = spans ? 100 : Math.min(115, Math.max(45, 45 + Math.round(Math.log2(Math.max(1, cSize)) * 14)));
      const vel = Math.min(127, Math.max(30, velBase + Math.floor((Math.random() - 0.5) * 10)));
      const gateDur = spans ? Math.round(baseGate * 1.35) : (cSize <= 2 ? Math.round(baseGate * 0.65) : baseGate);
      candidateEvents.push({ cellIdx, note, vel, gateDur, cSize, spans });
    }
  }

  // Use centralized polyphony strategy and voice limit
  const selectedEvents = selectPolyVoices(candidateEvents, maxPoly, state.polyStrategy);
  const selectedCount = selectedEvents.length;

  for (let i = 0; i < selectedCount; i++) {
    const ev = selectedEvents[i];
    chosenVoices[i] = ev.cellIdx;
    sparkLife[ev.cellIdx] = 1.0;
    cellFatigue[ev.cellIdx] = 1.0;
    cellAge[ev.cellIdx] = 0;
    const vKey = (voiceCounter++) % maxPoly;
    playPercolationVoice(vKey, ev.note, ev.vel, ev.gateDur);
  }

  // Evolutionary Erosion & Sedimentation Dynamics
  if (evoRate > 0) {
    let latticeMutated = false;

    // 1. Hydraulic Erosion: energetic discharge erodes closed neighbor wall
    for (let i = 0; i < selectedCount; i++) {
      if (Math.random() < evoRate * 0.16) {
        const cIdx = chosenVoices[i];
        const cx = cIdx % W;
        const cy = Math.floor(cIdx / W);
        const dir = Math.floor(Math.random() * 4);
        let nx = cx, ny = cy;
        if (dir === 0 && cx > 0) nx--;
        else if (dir === 1 && cx < W - 1) nx++;
        else if (dir === 2 && cy > 0) ny--;
        else if (dir === 3 && cy < H - 1) ny++;

        const nIdx = ny * W + nx;
        // Erode wall into open channel if lattice isn't oversaturated
        if (!grid[nIdx] && totalOpenCells < total * 0.72) {
          grid[nIdx] = 1;
          cellFatigue[nIdx] = 0.5;
          latticeMutated = true;
        }
      }
    }

    // 2. Sedimentation: stagnant channels silt up over scan cycles
    if (scanPhase === 0) {
      for (let i = 0; i < total; i++) {
        if (grid[i]) {
          cellAge[i]++;
          if (cellAge[i] > 12 && Math.random() < evoRate * 0.12) {
            // Silt up if lattice has enough open channels
            if (totalOpenCells > total * 0.30) {
              grid[i] = 0;
              cellFatigue[i] = 0;
              cellAge[i] = 0;
              latticeMutated = true;
            }
          }
        }
      }
    }

    if (latticeMutated) {
      recomputePercolationClusters();
    }
  }

  // MIDI CC #74 Brightness Modulation based on conduction energy
  const normConduction = Math.min(1.0, currentConduction + (stepMaxCluster / Math.max(1, total)) * 0.35);
  dispatchTimbreCc(normConduction, {
    dest: state.percolationCcDest ?? 74,
    depth: state.percolationCcDepth ?? 80,
    minVal: 20
  });
}

// Spark a specific cell directly (interactive direct manipulation)
export function sparkPercolationCell(cellIdx) {
  const W = getGridW();
  const H = getGridH();
  if (cellIdx < 0 || cellIdx >= W * H || !grid[cellIdx]) return;

  const cRoot = dsuFind(cellIdx);
  const cSize = clusterSize[cRoot];
  const intervals = getActiveScaleIntervals();
  const rootMidi = getRootMidi();
  const span = Math.min(4, Math.max(1, state.percolationSpan ?? 2));
  const baseGate = Math.min(600, Math.max(60, state.percolationGateLen ?? 180));
  const mapMode = state.percolationPitchMapping || "x-scale";

  // Flash all cells in this connected cluster
  for (let i = 0; i < W * H; i++) {
    if (grid[i] && dsuFind(i) === cRoot) {
      sparkLife[i] = 1.0;
    }
  }

  // Play chord arpeggio based on cluster size
  const chordNotes = Math.min(4, Math.max(1, Math.min(MAX_VOICES, Math.round(Math.log2(Math.max(2, cSize))))));
  for (let v = 0; v < chordNotes; v++) {
    const rawPitch = mapCellToPitch(cellIdx, cRoot, cSize, W, H, intervals, rootMidi, span, mapMode) + v * 4;
    const note = quantize(rawPitch, intervals, rootMidi);
    const vKey = (voiceCounter++) % MAX_VOICES;
    if (v === 0) {
      playPercolationVoice(vKey, note, 100, baseGate);
    } else {
      setTimeout(() => {
        playPercolationVoice(vKey, note, 90, baseGate);
      }, v * 45);
    }
  }
}

// ---- Autonomous Simulation Loop ----
function percolationLoop(timestamp) {
  if (!lastFrameTime) lastFrameTime = timestamp;
  const dt = Math.min(0.1, (timestamp - lastFrameTime) / 1000);
  lastFrameTime = timestamp;

  const speedMult = Math.max(0.1, Number(state.modelSpeed ?? 1.0));
  const scanRate = Math.max(0.5, (state.percolationScanRate ?? 8)) * speedMult;

  if (isPercolationPlaying) {
    scanAccumulator += dt * scanRate;
    while (scanAccumulator >= 1.0) {
      scanAccumulator -= 1.0;
      triggerConductionStep();
    }
  }

  // Decay spark visual highlights & recover cell refractory fatigue
  const total = getGridW() * getGridH();
  const restAmount = Math.min(1.0, Math.max(0.0, (state.percolationRest ?? 40) / 100));
  const recoveryRate = Math.max(0.12, (1.6 - restAmount * 1.25)) * speedMult;

  for (let i = 0; i < total; i++) {
    if (sparkLife[i] > 0.02) {
      sparkLife[i] *= 0.88;
    } else {
      sparkLife[i] = 0;
    }
    if (cellFatigue[i] > 0.01) {
      cellFatigue[i] = Math.max(0, cellFatigue[i] - dt * recoveryRate);
    }
  }

  renderPercolationCanvas();
  updateReadoutMetrics();

  animFrameId = requestAnimationFrame(percolationLoop);
}

export function isPercolationRunning() {
  return isPercolationPlaying;
}

export function startPercolation() {
  if (isPercolationPlaying) return;
  isPercolationPlaying = true;
  audio.unlock();
  scanAccumulator = 1.0;
  updatePlayBtnUI();
  status("Percolation Clusters: Playing · Fluid Porosity Conduction", "ok");
}

export function stopPercolation() {
  isPercolationPlaying = false;
  releaseAllVoices();
  updatePlayBtnUI();
  status("stopped");
}

export function togglePercolationRunning() {
  if (isPercolationPlaying) {
    stopPercolation();
    return false;
  } else {
    startPercolation();
    return true;
  }
}

function updatePlayBtnUI() {
  const headerBtn = document.getElementById("audition");
  if (headerBtn) {
    headerBtn.textContent = isPercolationPlaying ? "■ Stop" : "▶ Play";
    if (isPercolationPlaying) {
      headerBtn.classList.add("playing");
    } else {
      headerBtn.classList.remove("playing");
    }
  }
}

function updateReadoutMetrics() {
  if (!statReadoutEl) return;
  const W = getGridW();
  const H = getGridH();
  const pVal = (state.percolationProb ?? 0.593).toFixed(3);
  const spanStr = hasSpanningCluster ? `YES (${spanningClusterSize} cells)` : "NO";
  const condPct = Math.round(currentConduction * 100);
  const restVal = state.percolationRest ?? 40;
  const evoVal = state.percolationEvo ?? 25;
  statReadoutEl.textContent = `Lattice: ${W}×${H} · p: ${pVal} (pc ≈ 0.593) · Clusters: ${totalClusters} · Spanning: ${spanStr} · Rest: ${restVal}% · Evo: ${evoVal}% · Voices: ${getActiveVoiceCount()}/${state.polyphony ?? 4}`;
}

// ---- Canvas Rendering (Flat Workbench Aesthetic, Zero Gradients) ----
function renderPercolationCanvas() {
  if (!percolationCanvas) return;
  const ctx = percolationCanvas.getContext("2d");
  const w = percolationCanvas.width;
  const h = percolationCanvas.height;

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

  ctx.fillStyle = colPanel;
  ctx.fillRect(0, 0, w, h);

  const W = getGridW();
  const H = getGridH();
  const cellW = w / W;
  const cellH = h / H;

  // Render individual lattice cells
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const idx = y * W + x;
      const isOpen = grid[idx];
      const spans = isSpanning[idx];
      const spark = sparkLife[idx];

      if (spark > 0.05) {
        // Active spark flash: bright highlight
        ctx.fillStyle = "#ffffff";
        ctx.globalAlpha = 0.6 + spark * 0.4;
      } else if (!isOpen) {
        // Closed insulating cell
        ctx.fillStyle = colPanel2;
        ctx.globalAlpha = 0.5;
      } else if (spans) {
        // Spanning infinite cluster: vibrant accent2 (modulated by fatigue)
        const f = cellFatigue[idx];
        ctx.fillStyle = colAccent2;
        ctx.globalAlpha = f > 0.05 ? Math.max(0.35, 0.95 - f * 0.55) : 0.95;
      } else {
        // Open local cluster cell: solid accent (modulated by fatigue)
        const f = cellFatigue[idx];
        ctx.fillStyle = colAccent;
        ctx.globalAlpha = f > 0.05 ? Math.max(0.25, 0.65 - f * 0.40) : 0.65;
      }

      ctx.fillRect(x * cellW, y * cellH, cellW, cellH);

      // Subtle cell boundary divider
      if (cellW >= 6) {
        ctx.strokeStyle = colLine;
        ctx.lineWidth = 0.5;
        ctx.strokeRect(x * cellW, y * cellH, cellW, cellH);
      }
    }
  }
  ctx.globalAlpha = 1.0;

  // Render conduction wavefront indicator
  const scanMode = state.percolationScanMode || "top-down";
  ctx.strokeStyle = colOk;
  ctx.lineWidth = 2;

  if (scanMode === "top-down") {
    const wy = (scanPhase % H) * cellH;
    ctx.beginPath();
    ctx.moveTo(0, wy);
    ctx.lineTo(w, wy);
    ctx.stroke();
  } else if (scanMode === "left-right") {
    const wx = (scanPhase % W) * cellW;
    ctx.beginPath();
    ctx.moveTo(wx, 0);
    ctx.lineTo(wx, h);
    ctx.stroke();
  } else if (scanMode === "radial") {
    const cx = Math.floor(W / 2) * cellW + cellW / 2;
    const cy = Math.floor(H / 2) * cellH + cellH / 2;
    const maxR = Math.ceil(Math.hypot(W / 2, H / 2));
    const r = (scanPhase % maxR) * cellW;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Critical threshold indicator banner on canvas if p is near pc
  const p = state.percolationProb ?? 0.593;
  if (Math.abs(p - CRITICAL_P) < 0.015) {
    ctx.fillStyle = colAccent2;
    ctx.font = "bold 9px monospace";
    ctx.fillText("CRITICAL PHASE BOUNDARY (pc ≈ 0.593)", 8, 14);
  }
}

// ---- Step-based Generator Contract (Sync Mode) ----
export function generatePercolationBank(s = state) {
  const seqLen = s.length || 16;
  const rateIdx = typeof s.rate === "number" ? s.rate : RATE_NAMES.indexOf(s.rate);
  const safeRate = rateIdx >= 0 ? rateIdx : 6;
  const intervals = getActiveScaleIntervals();
  const root = getRootMidi();
  const span = Math.min(4, Math.max(1, s.percolationSpan ?? s.pitchSpan ?? 2));
  const W = getGridW();
  const H = getGridH();

  const bank = [];
  for (let b = 0; b < 16; b++) {
    const steps = [];
    for (let step = 0; step < seqLen; step++) {
      const rowY = step % H;
      let note = root;
      let vel = 0;
      let on = false;

      // Find first open conducting cell in this row
      for (let x = 0; x < W; x++) {
        const idx = rowY * W + x;
        if (grid[idx]) {
          on = true;
          const cRoot = dsuFind(idx);
          const cSize = clusterSize[cRoot];
          const deg = Math.floor((x / W) * intervals.length);
          note = quantize(root + Math.floor((1 - (rowY / H)) * span) * 12 + (intervals[deg] || 0), intervals, root);
          vel = Math.min(127, Math.max(40, 50 + Math.round(Math.log2(cSize) * 15)));
          break;
        }
      }

      steps.push({
        on,
        note,
        vel: on ? vel : 80,
        gate: 0.5,
        mod: 0
      });
    }
    bank.push({ length: seqLen, steps, rate: safeRate });
  }

  return bank;
}

export function randomizePercolation() {
  state.percolationProb = Number((0.35 + Math.random() * 0.45).toFixed(3));
  if (refs.percolationProb?.setValue) refs.percolationProb.setValue(state.percolationProb, false);
  reseedPercolation();
  renderPercolationCanvas();
}

export function syncPercolationFromRegen() {
  recomputePercolationClusters();
  renderPercolationCanvas();
}

function syncControlsFromState() {
  if (refs.percolationProb?.setValue) refs.percolationProb.setValue(state.percolationProb ?? 0.593, false);
  if (refs.percolationSpan?.setValue) refs.percolationSpan.setValue(state.percolationSpan ?? 2, false);
  if (refs.percolationPolyphony?.setValue) refs.percolationPolyphony.setValue(state.percolationPolyphony ?? 4, false);
  if (refs.percolationGateLen?.setValue) refs.percolationGateLen.setValue(state.percolationGateLen ?? 180, false);
  if (refs.percolationScanRate?.setValue) refs.percolationScanRate.setValue(state.percolationScanRate ?? 8, false);
  if (refs.percolationRest?.setValue) refs.percolationRest.setValue(state.percolationRest ?? 40, false);
  if (refs.percolationEvo?.setValue) refs.percolationEvo.setValue(state.percolationEvo ?? 25, false);
}

// ---- UI Construction (Flat Workbench Aesthetic) ----
export function initPercolation() {
  percolationContainer = document.getElementById("model-percolation");
  if (!percolationContainer) return;
  percolationContainer.innerHTML = "";

  const layout = document.createElement("div");
  layout.className = "layout-main";
  layout.style.display = "flex";
  layout.style.gap = "8px";
  layout.style.alignItems = "stretch";

  // --- Left Column: Controls & Configuration ---
  const module = document.createElement("div");
  module.className = "module percolation-module";
  module.style.display = "flex";
  module.style.flexDirection = "column";
  module.style.gap = "8px";
  module.style.width = "340px";
  module.style.flexShrink = "0";

  // Header Card
  const headerCard = document.createElement("div");
  headerCard.className = "card percolation-header-card";
  headerCard.style.padding = "8px 12px";

  const headerRow = document.createElement("div");
  headerRow.style.display = "flex";
  headerRow.style.justifyContent = "space-between";
  headerRow.style.alignItems = "center";
  headerRow.style.marginBottom = "6px";
  headerRow.innerHTML = `
    <span style="font-size:11px; font-weight:700; color:var(--fg); letter-spacing:1px; text-transform:uppercase;">Percolation Clusters</span>
    <span style="font-size:9px; color:var(--dim);">pc ≈ 0.5927 · DSU Porosity</span>
  `;

  // Presets & Reseed Actions
  const presetRow = document.createElement("div");
  presetRow.style.display = "flex";
  presetRow.style.gap = "6px";
  presetRow.style.alignItems = "center";

  const presetSelect = R("percolationPreset", dropdown({
    label: "PRESET",
    options: PERCOLATION_PRESETS.map((p) => ({ v: p.id, t: p.name })),
    value: state.percolationPreset || "critical",
    onInput: (val) => {
      state.percolationPreset = val;
      const pDef = PERCOLATION_PRESETS.find((p) => p.id === val);
      if (pDef) {
        if (pDef.p !== undefined) {
          state.percolationProb = pDef.p;
          if (refs.percolationProb?.setValue) refs.percolationProb.setValue(pDef.p, false);
        }
        if (pDef.scan) state.percolationScanMode = pDef.scan;
        if (pDef.map) state.percolationPitchMapping = pDef.map;
        if (pDef.conn) state.percolationConn = pDef.conn;
        reseedPercolation(val);
        renderPercolationCanvas();
      }
    }
  }));

  const reseedBtn = R("btnPercolationReseed", actionBtn(
    "RESEED",
    () => {
      reseedPercolation();
      renderPercolationCanvas();
    },
    "Randomize lattice site occupancy with current probability p"
  ));

  presetRow.append(presetSelect, reseedBtn);
  headerCard.append(headerRow, presetRow);

  // Parameters Card
  const paramCard = document.createElement("div");
  paramCard.className = "card percolation-param-card";
  paramCard.style.padding = "8px 12px";
  paramCard.style.display = "flex";
  paramCard.style.flexDirection = "column";
  paramCard.style.gap = "8px";

  const paramGrid = document.createElement("div");
  paramGrid.style.display = "grid";
  paramGrid.style.gridTemplateColumns = "repeat(3, 1fr)";
  paramGrid.style.gap = "6px";

  const kProb = R("percolationProb", knob({
    label: "PROB",
    min: 0.10,
    max: 0.90,
    step: 0.005,
    value: state.percolationProb ?? 0.593,
    title: "Site occupancy probability p (critical threshold pc ≈ 0.593)",
    onInput: (v) => {
      state.percolationProb = Number(v.toFixed(3));
      reseedPercolation();
      renderPercolationCanvas();
    }
  }));

  const kScanRate = R("percolationScanRate", knob({
    label: "RATE",
    min: 1,
    max: 32,
    step: 1,
    value: state.percolationScanRate ?? 8,
    title: "Conduction wavefront scan speed",
    onInput: (v) => {
      state.percolationScanRate = Math.round(v);
    }
  }));

  const kRest = R("percolationRest", knob({
    label: "REST",
    min: 0,
    max: 100,
    step: 1,
    value: state.percolationRest ?? 40,
    title: "Refractory fatigue cool-down (higher = longer rest before re-triggering)",
    onInput: (v) => {
      state.percolationRest = Math.round(v);
    }
  }));

  const kEvo = R("percolationEvo", knob({
    label: "EVO",
    min: 0,
    max: 100,
    step: 1,
    value: state.percolationEvo ?? 25,
    title: "Dynamic porosity evolution (hydraulic erosion & sedimentation rate)",
    onInput: (v) => {
      state.percolationEvo = Math.round(v);
    }
  }));

  const kSpan = R("percolationSpan", knob({
    label: "SPAN",
    min: 1,
    max: 4,
    step: 1,
    value: state.percolationSpan ?? 2,
    title: "Pitch octave span",
    onInput: (v) => {
      state.percolationSpan = Math.round(v);
    }
  }));

  paramGrid.append(kProb, kScanRate, kRest, kEvo, kSpan);

  // Dropdown Selectors
  const dropdownRow = document.createElement("div");
  dropdownRow.style.display = "grid";
  dropdownRow.style.gridTemplateColumns = "repeat(2, 1fr)";
  dropdownRow.style.gap = "6px";

  const pScan = R("percolationScanMode", dropdown({
    label: "SCAN",
    options: [
      { v: "top-down", t: "Top-Down Pulse" },
      { v: "left-right", t: "Left-Right Sweep" },
      { v: "radial", t: "Radial Ripple" },
      { v: "fluid", t: "Fluid Trickle" },
      { v: "spanning", t: "Spanning Only" }
    ],
    value: state.percolationScanMode || "top-down",
    onInput: (v) => {
      state.percolationScanMode = v;
      scanPhase = 0;
    }
  }));

  const pMapping = R("percolationPitchMapping", dropdown({
    label: "MAPPING",
    options: [
      { v: "x-scale", t: "X-Pos → Scale" },
      { v: "cluster-size", t: "Cluster Size" },
      { v: "centroid", t: "Centroid Octave" },
      { v: "harmonic", t: "Harmonic Tree" }
    ],
    value: state.percolationPitchMapping || "x-scale",
    onInput: (v) => {
      state.percolationPitchMapping = v;
    }
  }));

  const pGridDim = R("percolationGridDim", dropdown({
    label: "GRID",
    options: [
      { v: "24x16", t: "24 × 16" },
      { v: "32x20", t: "32 × 20" },
      { v: "40x24", t: "40 × 24" }
    ],
    value: state.percolationGridDim || "32x20",
    onInput: (v) => {
      state.percolationGridDim = v;
      reseedPercolation();
      renderPercolationCanvas();
    }
  }));

  const pConn = R("percolationConn", dropdown({
    label: "CONN",
    options: [
      { v: "4-way", t: "4-Way Cardinal" },
      { v: "8-way", t: "8-Way Moore" }
    ],
    value: state.percolationConn || "4-way",
    onInput: (v) => {
      state.percolationConn = v;
      recomputePercolationClusters();
      renderPercolationCanvas();
    }
  }));

  dropdownRow.append(pScan, pMapping, pGridDim, pConn);
  paramCard.append(paramGrid, dropdownRow);
  module.append(headerCard, paramCard);

  // --- Right Column: Interactive Percolation Canvas ---
  const display = document.createElement("div");
  display.className = "display percolation-display";
  display.style.flex = "1";
  display.style.display = "flex";
  display.style.flexDirection = "column";

  const canvasCard = document.createElement("div");
  canvasCard.className = "card percolation-canvas-card";
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
    <span style="font-size:10px; font-weight:700; color:var(--fg); letter-spacing:1px; text-transform:uppercase;">Percolation Porosity Matrix</span>
    <span style="font-size:9px; color:var(--dim);">Click/Drag to carve channels · Shift+Click to spark cluster</span>
  `;

  percolationCanvas = document.createElement("canvas");
  percolationCanvas.width = 640;
  percolationCanvas.height = 400;
  percolationCanvas.style.width = "100%";
  percolationCanvas.style.maxWidth = "640px";
  percolationCanvas.style.aspectRatio = "16 / 10";
  percolationCanvas.style.background = "var(--panel)";
  percolationCanvas.style.border = "1px solid var(--line)";
  percolationCanvas.style.cursor = "crosshair";

  // Canvas Direct Manipulation: Click/Drag to toggle porosity, Shift-Click to spark
  let isPointerDown = false;
  let paintValue = 1;

  function handleCanvasPointer(e) {
    audio.unlock();
    const rect = percolationCanvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const W = getGridW();
    const H = getGridH();
    const cellX = Math.floor((mx / rect.width) * W);
    const cellY = Math.floor((my / rect.height) * H);

    if (cellX >= 0 && cellX < W && cellY >= 0 && cellY < H) {
      const idx = cellY * W + cellX;
      if (e.shiftKey) {
        sparkPercolationCell(idx);
      } else {
        grid[idx] = paintValue;
        recomputePercolationClusters();
        if (paintValue === 1) {
          sparkPercolationCell(idx);
        }
      }
      renderPercolationCanvas();
    }
  }

  percolationCanvas.addEventListener("pointerdown", (e) => {
    isPointerDown = true;
    percolationCanvas.setPointerCapture(e.pointerId);
    const rect = percolationCanvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const W = getGridW();
    const H = getGridH();
    const cellX = Math.floor((mx / rect.width) * W);
    const cellY = Math.floor((my / rect.height) * H);
    if (cellX >= 0 && cellX < W && cellY >= 0 && cellY < H) {
      const idx = cellY * W + cellX;
      paintValue = grid[idx] ? 0 : 1;
    }
    handleCanvasPointer(e);
  });

  percolationCanvas.addEventListener("pointermove", (e) => {
    if (isPointerDown) {
      handleCanvasPointer(e);
    }
  });

  percolationCanvas.addEventListener("pointerup", () => {
    isPointerDown = false;
  });

  percolationCanvas.addEventListener("pointercancel", () => {
    isPointerDown = false;
  });

  // Footer status bar for physical metrics
  statReadoutEl = document.createElement("div");
  statReadoutEl.style.fontSize = "9px";
  statReadoutEl.style.color = "var(--dim)";
  statReadoutEl.style.marginTop = "6px";
  statReadoutEl.style.fontFamily = "monospace";
  statReadoutEl.textContent = "Lattice: 32×20 · p: 0.593 · Clusters: 0 · Spanning: NO · Conduction: 0% · Voices: 0/4";

  canvasCard.append(canvasHeader, percolationCanvas, statReadoutEl);
  display.appendChild(canvasCard);

  layout.append(module, display);
  percolationContainer.appendChild(layout);

  reseedPercolation();
  syncControlsFromState();
}

// ---- Model Activation Lifecycle ----
export function activatePercolationModel() {
  setModelGenerator(generatePercolationBank);
  setModelRandomizer(randomizePercolation);
  setModelStepHandler(null);
  setModelTransportHandler({
    toggle: togglePercolationRunning,
    stop: stopPercolation,
    start: startPercolation,
    isRunning: isPercolationRunning
  });

  doGenerate(false);
  renderPercolationCanvas();

  if (!animFrameId) {
    lastFrameTime = performance.now();
    animFrameId = requestAnimationFrame(percolationLoop);
  }

  updatePlayBtnUI();
  status("Percolation Clusters: Ready (Press Play or Spacebar to start conduction)", "ok");
}

export function deactivatePercolationModel() {
  stopPercolation();
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
  id: "percolation",
  version: 1,
  migrations: {},
  capture: () => {
    const W = getGridW();
    const H = getGridH();
    const cellBits = [];
    for (let i = 0; i < W * H; i++) cellBits.push(grid[i]);

    return {
      dim: state.percolationGridDim,
      prob: state.percolationProb,
      scan: state.percolationScanMode,
      mapping: state.percolationPitchMapping,
      conn: state.percolationConn,
      scanRate: state.percolationScanRate,
      polyphony: state.percolationPolyphony,
      span: state.percolationSpan,
      gateLen: state.percolationGateLen,
      rest: state.percolationRest,
      evo: state.percolationEvo,
      preset: state.percolationPreset,
      cells: cellBits
    };
  },
  restore: (h) => {
    if (!h) return;
    if (h.dim) state.percolationGridDim = h.dim;
    if (h.prob !== undefined) state.percolationProb = h.prob;
    if (h.scan) state.percolationScanMode = h.scan;
    if (h.mapping) state.percolationPitchMapping = h.mapping;
    if (h.conn) state.percolationConn = h.conn;
    if (h.scanRate !== undefined) state.percolationScanRate = h.scanRate;
    if (h.polyphony !== undefined) state.percolationPolyphony = h.polyphony;
    if (h.span !== undefined) state.percolationSpan = h.span;
    if (h.gateLen !== undefined) state.percolationGateLen = h.gateLen;
    if (h.rest !== undefined) state.percolationRest = h.rest;
    if (h.evo !== undefined) state.percolationEvo = h.evo;
    if (h.preset) state.percolationPreset = h.preset;

    if (Array.isArray(h.cells)) {
      const W = getGridW();
      const H = getGridH();
      for (let i = 0; i < Math.min(W * H, h.cells.length); i++) {
        grid[i] = h.cells[i] ? 1 : 0;
      }
      recomputePercolationClusters();
    } else {
      reseedPercolation();
    }

    syncControlsFromState();
    renderPercolationCanvas();
  }
});
